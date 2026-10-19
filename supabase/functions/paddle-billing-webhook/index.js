/* global Deno, Response, TextEncoder, crypto, console */

import { createClient } from 'npm:@supabase/supabase-js@2';

const MAX_BODY_BYTES = 256 * 1024;
const SIGNATURE_TOLERANCE_SECONDS = 300;
const SUPPORTED_EVENTS = new Set([
  'subscription.created',
  'subscription.updated',
  'subscription.activated',
  'subscription.trialing',
  'subscription.past_due',
  'subscription.paused',
  'subscription.resumed',
  'subscription.canceled',
]);
const SUPPORTED_STATUSES = new Set([
  'active',
  'trialing',
  'past_due',
  'paused',
  'canceled',
]);

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

function parseSignatureHeader(header) {
  const values = new Map();
  for (const part of header?.split(';') ?? []) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    values.set(key, [...(values.get(key) ?? []), value]);
  }

  const timestamp = values.get('ts')?.[0];
  const signatures = values.get('h1') ?? [];
  if (!timestamp || signatures.length === 0 || !/^\d+$/.test(timestamp)) {
    return undefined;
  }
  return { timestamp, signatures };
}

function hex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function verifyPaddleSignature(rawBody, header, secret) {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;

  const timestamp = Number(parsed.timestamp);
  const now = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(now - timestamp) > SIGNATURE_TOLERANCE_SECONDS
  ) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${parsed.timestamp}:${rawBody}`),
  );
  const expected = hex(digest);
  return parsed.signatures.some((signature) =>
    constantTimeEqual(expected, signature.toLowerCase()),
  );
}

async function sha256(value) {
  return hex(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseEvent(payload) {
  if (!payload || typeof payload !== 'object') return undefined;

  const eventId = nonEmptyString(payload.event_id);
  const eventType = nonEmptyString(payload.event_type);
  const occurredAt = nonEmptyString(payload.occurred_at);
  const data = payload.data;
  if (
    !eventId ||
    !eventType ||
    !occurredAt ||
    !SUPPORTED_EVENTS.has(eventType) ||
    !data ||
    typeof data !== 'object'
  ) {
    return undefined;
  }

  const tenantId = nonEmptyString(data.custom_data?.crewflow_tenant_id);
  const customerId = nonEmptyString(data.customer_id);
  const subscriptionId = nonEmptyString(data.id);
  const status = nonEmptyString(data.status);
  const period = data.current_billing_period;
  const startsAt = nonEmptyString(period?.starts_at) ?? null;
  const endsAt = nonEmptyString(period?.ends_at) ?? null;
  const priceIds = new Set(
    (Array.isArray(data.items) ? data.items : [])
      .map((item) => nonEmptyString(item?.price?.id))
      .filter(Boolean),
  );

  if (
    !tenantId ||
    !customerId ||
    !subscriptionId ||
    !status ||
    !SUPPORTED_STATUSES.has(status) ||
    priceIds.size !== 1 ||
    Number.isNaN(Date.parse(occurredAt)) ||
    (startsAt !== null && Number.isNaN(Date.parse(startsAt))) ||
    (endsAt !== null && Number.isNaN(Date.parse(endsAt)))
  ) {
    return undefined;
  }

  return {
    eventId,
    eventType,
    occurredAt,
    tenantId,
    customerId,
    subscriptionId,
    priceId: [...priceIds][0],
    status,
    startsAt,
    endsAt,
    cancelAtPeriodEnd: data.scheduled_change?.action === 'cancel',
  };
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405);
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (contentLength > MAX_BODY_BYTES) {
    return json({ error: 'Payload too large.' }, 413);
  }

  const webhookSecret = Deno.env.get('PADDLE_SANDBOX_WEBHOOK_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const secretKeys = configuredSecretKeys();
  if (!webhookSecret || !supabaseUrl || secretKeys.length === 0) {
    return json({ error: 'Sandbox billing webhook is not configured.' }, 503);
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return json({ error: 'Payload too large.' }, 413);
  }

  const signature = request.headers.get('paddle-signature');
  if (!(await verifyPaddleSignature(rawBody, signature, webhookSecret))) {
    return json({ error: 'Invalid webhook signature.' }, 401);
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  if (!SUPPORTED_EVENTS.has(payload?.event_type)) {
    return json({ accepted: true, result: 'event_not_required' });
  }

  const event = parseEvent(payload);
  if (!event) {
    return json({ error: 'Invalid subscription event.' }, 422);
  }

  const admin = createClient(supabaseUrl, secretKeys[0], {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: result, error } = await admin.rpc(
    'apply_paddle_sandbox_subscription_event',
    {
      target_event_id: event.eventId,
      target_event_type: event.eventType,
      target_occurred_at: event.occurredAt,
      target_payload_sha256: await sha256(rawBody),
      target_tenant_id: event.tenantId,
      target_provider_customer_id: event.customerId,
      target_provider_subscription_id: event.subscriptionId,
      target_provider_price_id: event.priceId,
      target_status: event.status,
      target_period_starts_at: event.startsAt,
      target_period_ends_at: event.endsAt,
      target_cancel_at_period_end: event.cancelAtPeriodEnd,
    },
  );

  if (error) {
    console.error('Unable to apply verified Paddle sandbox event.');
    return json({ error: 'Billing event processing failed.' }, 500);
  }

  if (result === 'payload_conflict') {
    return json({ error: 'Event payload conflict.' }, 409);
  }
  if (result === 'plan_not_configured' || result === 'tenant_not_found') {
    return json({ error: 'Billing configuration is incomplete.' }, 503);
  }

  return json({ accepted: true, result });
});
