/* global Deno, Response, URL, console, fetch */

import { createClient } from 'npm:@supabase/supabase-js@2';

const PADDLE_API_URL = 'https://sandbox-api.paddle.com';
const PADDLE_SANDBOX_KEY =
  /^pdl_sdbx_apikey_[a-z\d]{26}_[a-zA-Z\d]{22}_[a-zA-Z\d]{3}$/;
const PORTAL_HOST = 'sandbox-customer-portal.paddle.com';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
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

function bearerToken(request) {
  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return undefined;
  const token = authorization.slice('Bearer '.length);
  return token.length >= 20 && token.length <= 8192 ? token : undefined;
}

function validPortalUrl(candidate) {
  try {
    const url = new URL(candidate);
    return (
      url.protocol === 'https:' &&
      url.hostname === PORTAL_HOST &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const secretKeys = configuredSecretKeys();
  const paddleApiKey = Deno.env.get('PADDLE_SANDBOX_API_KEY');
  if (!supabaseUrl || secretKeys.length === 0) {
    return json({ error: 'Billing portal is not configured.' }, 500);
  }

  const token = bearerToken(request);
  if (!token) return json({ error: 'Unauthorized.' }, 401);

  const admin = createClient(supabaseUrl, secretKeys[0], {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) {
    return json({ error: 'Unauthorized.' }, 401);
  }

  const { data: contexts, error: contextError } = await admin.rpc(
    'get_owner_billing_portal_context',
    { target_user_id: userData.user.id },
  );
  const context = contexts?.[0];
  if (contextError) {
    console.error('Unable to authorize billing portal access.');
    return json({ error: 'Billing portal authorization failed.' }, 500);
  }
  if (
    context?.provider !== 'paddle_sandbox' ||
    !context.provider_customer_id ||
    !context.provider_subscription_id
  ) {
    return json({ error: 'Sandbox subscription is not configured.' }, 409);
  }
  if (!paddleApiKey || !PADDLE_SANDBOX_KEY.test(paddleApiKey)) {
    return json({ error: 'Paddle sandbox portal is dormant.' }, 503);
  }

  let response;
  try {
    response = await fetch(
      `${PADDLE_API_URL}/customers/${context.provider_customer_id}/portal-sessions`,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${paddleApiKey}`,
          'content-type': 'application/json',
          'paddle-version': '1',
        },
        body: JSON.stringify({
          subscription_ids: [context.provider_subscription_id],
        }),
      },
    );
  } catch {
    return json({ error: 'Paddle sandbox portal is unavailable.' }, 502);
  }

  if (!response.ok) {
    console.error(
      `Paddle portal request failed with status ${response.status}.`,
    );
    return json({ error: 'Paddle sandbox portal is unavailable.' }, 502);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return json({ error: 'Paddle sandbox portal returned invalid data.' }, 502);
  }

  const portalUrl = payload?.data?.urls?.general?.overview;
  if (!validPortalUrl(portalUrl)) {
    return json(
      { error: 'Paddle sandbox portal returned an unsafe link.' },
      502,
    );
  }

  return json({ portal_url: portalUrl });
});
