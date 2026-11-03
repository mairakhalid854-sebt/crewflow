/* global Deno, Response, console */

import { createClient } from 'npm:@supabase/supabase-js@2';

import {
  suppressionsFromWebhookEvent,
  verifyResendWebhook,
} from '../_shared/email-delivery.ts';

const MAX_BODY_BYTES = 64 * 1024;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405);
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_BODY_BYTES) {
    return json({ error: 'Payload too large.' }, 413);
  }
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return json({ error: 'Payload too large.' }, 413);
  }

  const verified = await verifyResendWebhook(
    rawBody,
    {
      id: request.headers.get('svix-id'),
      timestamp: request.headers.get('svix-timestamp'),
      signature: request.headers.get('svix-signature'),
    },
    Deno.env.get('RESEND_WEBHOOK_SECRET'),
  );
  if (!verified) {
    return json({ error: 'Unauthorized.' }, 401);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: 'Invalid payload.' }, 400);
  }

  const suppressions = suppressionsFromWebhookEvent(event);
  if (suppressions.length === 0) {
    return json({ received: true, suppressed: 0 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Email webhook service is not configured.' }, 500);
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let suppressed = 0;
  for (const suppression of suppressions) {
    const { data, error } = await admin.rpc(
      'record_provider_email_suppression',
      {
        target_email: suppression.email,
        target_reason: suppression.reason,
      },
    );
    if (error) {
      // A non-2xx response makes Resend redeliver the event later.
      console.error('Unable to record provider email suppression.');
      return json({ error: 'Suppression failed.' }, 500);
    }
    suppressed += typeof data === 'number' ? data : 0;
  }

  return json({ received: true, suppressed });
});
