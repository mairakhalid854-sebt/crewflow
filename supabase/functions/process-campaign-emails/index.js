/* global Deno, Response, TextEncoder, console, crypto, fetch, setTimeout */

// Sends queued weather campaign emails. Marketing mail is held unless the
// operator switch CREWFLOW_MARKETING_EMAIL_ENABLED is on and a trusted app
// origin exists. Every message gets the unsubscribe link, one-click
// unsubscribe headers, and the business postal address.

import { createClient } from 'npm:@supabase/supabase-js@2';

import {
  EMAIL_BATCH_SIZE,
  RESEND_EMAILS_URL,
  buildResendEmail,
  classifyResendResponse,
  idempotencyKey,
  parseAppOrigin,
  parseSenderAddress,
  prepareMarketingEmail,
} from '../_shared/email-delivery.ts';

// Resend's default account limit is two requests per second.
const SEND_SPACING_MS = 600;
const BOOKING_PATH = /^\/book\/[a-z0-9-]{3,48}$/;

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
      for (const value of Object.values(JSON.parse(encodedKeys))) {
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

async function digest(value) {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
}

async function isAuthorized(suppliedKey, secretKeys) {
  if (!suppliedKey || secretKeys.length === 0) return false;
  const supplied = await digest(suppliedKey);
  for (const secretKey of secretKeys) {
    const expected = await digest(secretKey);
    let difference = supplied.length ^ expected.length;
    for (let index = 0; index < supplied.length; index += 1) {
      difference |= supplied[index] ^ expected[index];
    }
    if (difference === 0) return true;
  }
  return false;
}

async function send(delivery, apiKey, senderAddress, headers) {
  let response;
  try {
    response = await fetch(RESEND_EMAILS_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey(delivery, 'weather-campaign'),
      },
      body: JSON.stringify(
        buildResendEmail(delivery, senderAddress, 'weather_campaign', headers),
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

/** Replaces {{booking_link}} with the trusted origin and booking path. */
function withBookingLink(body, origin, bookingPath) {
  if (!body.includes('{{booking_link}}')) return body;
  if (typeof bookingPath !== 'string' || !BOOKING_PATH.test(bookingPath)) {
    return null;
  }
  return body.replaceAll('{{booking_link}}', `${origin}${bookingPath}`);
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

  const apiKey = Deno.env.get('RESEND_API_KEY');
  const senderAddress = parseSenderAddress(
    Deno.env.get('CREWFLOW_EMAIL_FROM_ADDRESS'),
  );
  const origin = parseAppOrigin(Deno.env.get('CREWFLOW_WEB_APP_URL'));
  const marketingEnabled =
    Deno.env.get('CREWFLOW_MARKETING_EMAIL_ENABLED') === 'true';
  if (!apiKey || !senderAddress || !origin || !marketingEnabled) {
    // Leave messages ready rather than burning their bounded attempts.
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
    'claim_campaign_email_deliveries',
    { target_batch_size: EMAIL_BATCH_SIZE },
  );
  if (claimError) {
    console.error('Unable to claim campaign email deliveries.');
    return json({ error: 'Email delivery claim failed.' }, 500);
  }

  const counts = {
    claimed: claimed?.length ?? 0,
    sent: 0,
    retried: 0,
    failed: 0,
  };

  for (const [index, delivery] of (claimed ?? []).entries()) {
    if (index > 0) {
      await new Promise((resolve) => setTimeout(resolve, SEND_SPACING_MS));
    }

    const linked = withBookingLink(
      delivery.body,
      origin,
      delivery.booking_path,
    );
    const marketing = linked
      ? prepareMarketingEmail(
          linked,
          origin,
          delivery.unsubscribe_token,
          delivery.postal_address,
          delivery.sender_name,
        )
      : null;
    const result = marketing
      ? await send(
          { ...delivery, body: marketing.text },
          apiKey,
          senderAddress,
          marketing.headers,
        )
      : {
          outcome: 'failed',
          errorCode: linked
            ? 'marketing_footer_unavailable'
            : 'booking_link_unavailable',
        };

    if (result.outcome === 'sent') {
      const { error } = await admin.rpc('complete_campaign_email_delivery', {
        target_lease_token: delivery.lease_token,
        target_message_id: delivery.message_id,
        target_provider_message_id: result.providerMessageId,
      });
      if (error) {
        console.error('Unable to complete campaign email delivery.');
        continue;
      }
      counts.sent += 1;
      continue;
    }

    const { data: status, error } = await admin.rpc(
      'retry_campaign_email_delivery',
      {
        target_error_code: result.errorCode,
        target_lease_token: delivery.lease_token,
        target_message_id: delivery.message_id,
        target_permanent: result.outcome === 'failed',
      },
    );
    if (error) {
      console.error('Unable to schedule campaign email retry.');
      continue;
    }
    if (status === 'failed') counts.failed += 1;
    else counts.retried += 1;
  }

  return json({ configured: true, ...counts });
});
