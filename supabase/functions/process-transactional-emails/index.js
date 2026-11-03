/* global Deno, Response, TextEncoder, console, crypto, fetch, setTimeout */

import { createClient } from 'npm:@supabase/supabase-js@2';

import {
  EMAIL_BATCH_SIZE,
  RESEND_EMAILS_URL,
  buildResendEmail,
  classifyResendResponse,
  idempotencyKey,
  parseAppOrigin,
  parseSenderAddress,
  renderLinkedBody,
} from '../_shared/email-delivery.ts';

// Resend's default account limit is two requests per second.
const SEND_SPACING_MS = 600;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function configuredSecretKeys() {
  const keys = [];
  const encodedKeys = Deno.env.get('SUPABASE_SECRET_KEYS');

  if (encodedKeys) {
    try {
      const parsed = JSON.parse(encodedKeys);
      for (const value of Object.values(parsed)) {
        if (typeof value === 'string' && value.length > 0) keys.push(value);
      }
    } catch {
      return [];
    }
  }

  const legacyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacyKey) keys.push(legacyKey);
  return [...new Set(keys)];
}

async function hash(value) {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
}

async function isAuthorized(suppliedKey, secretKeys) {
  if (!suppliedKey || secretKeys.length === 0) return false;

  const suppliedHash = await hash(suppliedKey);
  for (const secretKey of secretKeys) {
    const secretHash = await hash(secretKey);
    let difference = 0;
    for (let index = 0; index < suppliedHash.length; index += 1) {
      difference |= suppliedHash[index] ^ secretHash[index];
    }
    if (difference === 0) return true;
  }

  return false;
}

async function send(delivery, apiKey, senderAddress) {
  let response;
  try {
    response = await fetch(RESEND_EMAILS_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey(delivery, 'transactional'),
      },
      body: JSON.stringify(
        buildResendEmail(delivery, senderAddress, 'transactional_document'),
      ),
    });
  } catch {
    return { outcome: 'retry', errorCode: 'resend_network_error' };
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return classifyResendResponse(response.status, body);
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405);
  }

  const secretKeys = configuredSecretKeys();
  if (!(await isAuthorized(request.headers.get('apikey'), secretKeys))) {
    return json({ error: 'Unauthorized.' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const adminKey = secretKeys[0];
  if (!supabaseUrl || !adminKey) {
    return json({ error: 'Email delivery service is not configured.' }, 500);
  }

  // Leave queued mail untouched until the provider, sender, and trusted link
  // origin are all configured.
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const senderAddress = parseSenderAddress(
    Deno.env.get('CREWFLOW_EMAIL_FROM_ADDRESS'),
  );
  const origin = parseAppOrigin(Deno.env.get('CREWFLOW_WEB_APP_URL'));
  if (!apiKey || !senderAddress || !origin) {
    return json({
      configured: false,
      claimed: 0,
      sent: 0,
      retried: 0,
      failed: 0,
    });
  }

  const admin = createClient(supabaseUrl, adminKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: claimed, error: claimError } = await admin.rpc(
    'claim_transactional_emails',
    { target_batch_size: EMAIL_BATCH_SIZE },
  );

  if (claimError) {
    console.error('Unable to claim transactional emails.');
    return json({ error: 'Email delivery claim failed.' }, 500);
  }

  const counts = {
    claimed: claimed?.length ?? 0,
    sent: 0,
    retried: 0,
    failed: 0,
  };

  for (const [index, row] of (claimed ?? []).entries()) {
    if (index > 0) {
      await new Promise((resolve) => setTimeout(resolve, SEND_SPACING_MS));
    }

    const body = renderLinkedBody(row.body, origin, row.link_path);
    const result = body
      ? await send(
          { ...row, message_id: row.email_id, body },
          apiKey,
          senderAddress,
        )
      : { outcome: 'failed', errorCode: 'invalid_email_link' };

    if (result.outcome === 'sent') {
      const { error } = await admin.rpc('complete_transactional_email', {
        target_email_id: row.email_id,
        target_lease_token: row.lease_token,
        target_provider_message_id: result.providerMessageId,
      });
      if (error) {
        console.error('Unable to complete transactional email.');
        continue;
      }
      counts.sent += 1;
      continue;
    }

    const { data: status, error } = await admin.rpc(
      'retry_transactional_email',
      {
        target_email_id: row.email_id,
        target_lease_token: row.lease_token,
        target_error_code: result.errorCode,
        target_permanent: result.outcome === 'failed',
      },
    );
    if (error) {
      console.error('Unable to schedule transactional email retry.');
      continue;
    }
    if (status === 'failed') counts.failed += 1;
    else counts.retried += 1;
  }

  return json({ configured: true, ...counts });
});
