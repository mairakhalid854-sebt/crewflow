/* global Deno, Response, TextEncoder, crypto, console, fetch */

import { createClient } from 'npm:@supabase/supabase-js@2';

const BATCH_SIZE = 25;
const CONCURRENCY = 5;
const PADDLE_API_URL = 'https://sandbox-api.paddle.com';
const PADDLE_SANDBOX_KEY =
  /^pdl_sdbx_apikey_[a-z\d]{26}_[a-zA-Z\d]{22}_[a-zA-Z\d]{3}$/;
const PADDLE_IDS = {
  customer: /^ctm_[a-z\d]{26}$/,
  price: /^pri_[a-z\d]{26}$/,
  subscription: /^sub_[a-z\d]{26}$/,
};
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
    if (suppliedHash.length !== secretHash.length) continue;
    let difference = 0;
    for (let index = 0; index < suppliedHash.length; index += 1) {
      difference |= suppliedHash[index] ^ secretHash[index];
    }
    if (difference === 0) return true;
  }

  return false;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function validDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function parseSnapshot(payload, expected) {
  const data = payload?.data;
  const id = nonEmptyString(data?.id);
  const customerId = nonEmptyString(data?.customer_id);
  const status = nonEmptyString(data?.status);
  const updatedAt = nonEmptyString(data?.updated_at);
  const period = data?.current_billing_period;
  const startsAt = period === null ? null : nonEmptyString(period?.starts_at);
  const endsAt = period === null ? null : nonEmptyString(period?.ends_at);
  const priceIds = new Set(
    (Array.isArray(data?.items) ? data.items : [])
      .map((item) => nonEmptyString(item?.price?.id))
      .filter(Boolean),
  );
  const customTenantId = nonEmptyString(data?.custom_data?.crewflow_tenant_id);

  if (
    !id ||
    !customerId ||
    !status ||
    !updatedAt ||
    !PADDLE_IDS.subscription.test(id) ||
    !PADDLE_IDS.customer.test(customerId) ||
    id !== expected.provider_subscription_id ||
    customerId !== expected.provider_customer_id ||
    !SUPPORTED_STATUSES.has(status) ||
    !validDate(updatedAt) ||
    priceIds.size !== 1 ||
    !PADDLE_IDS.price.test([...priceIds][0]) ||
    (period !== null && (!validDate(startsAt) || !validDate(endsAt))) ||
    (customTenantId !== undefined && customTenantId !== expected.tenant_id)
  ) {
    return undefined;
  }

  return {
    customerId,
    subscriptionId: id,
    priceId: [...priceIds][0],
    status,
    startsAt,
    endsAt,
    cancelAtPeriodEnd: data?.scheduled_change?.action === 'cancel',
    updatedAt,
  };
}

async function reconcileOne(admin, paddleApiKey, subscription) {
  let response;
  try {
    response = await fetch(
      `${PADDLE_API_URL}/subscriptions/${subscription.provider_subscription_id}`,
      {
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${paddleApiKey}`,
          'paddle-version': '1',
        },
      },
    );
  } catch {
    return { failed: true, code: 'paddle_network_error' };
  }

  if (!response.ok) {
    return { failed: true, code: `paddle_http_${response.status}` };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return { failed: true, code: 'paddle_invalid_json' };
  }

  const snapshot = parseSnapshot(payload, subscription);
  if (!snapshot) {
    return { failed: true, code: 'paddle_invalid_snapshot' };
  }

  const { data: result, error } = await admin.rpc(
    'apply_paddle_sandbox_reconciliation_snapshot',
    {
      target_tenant_id: subscription.tenant_id,
      target_provider_customer_id: snapshot.customerId,
      target_provider_subscription_id: snapshot.subscriptionId,
      target_provider_price_id: snapshot.priceId,
      target_status: snapshot.status,
      target_period_starts_at: snapshot.startsAt,
      target_period_ends_at: snapshot.endsAt,
      target_cancel_at_period_end: snapshot.cancelAtPeriodEnd,
      target_provider_updated_at: snapshot.updatedAt,
    },
  );

  if (error) return { failed: true, code: 'snapshot_apply_failed' };
  if (
    result === 'plan_not_configured' ||
    result === 'subscription_not_found' ||
    result === 'identity_mismatch'
  ) {
    return { failed: true, code: result };
  }

  return { failed: false, updated: result === 'updated' };
}

async function runBounded(items, worker) {
  const results = [];
  for (let index = 0; index < items.length; index += CONCURRENCY) {
    results.push(
      ...(await Promise.all(
        items.slice(index, index + CONCURRENCY).map(worker),
      )),
    );
  }
  return results;
}

async function finishRun(admin, runId, result) {
  return admin.rpc('finish_paddle_sandbox_reconciliation', {
    target_run_id: runId,
    target_status: result.status,
    target_checked_count: result.checked,
    target_updated_count: result.updated,
    target_failure_count: result.failures,
    target_error_code: result.errorCode ?? null,
  });
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
  const paddleApiKey = Deno.env.get('PADDLE_SANDBOX_API_KEY');
  if (!supabaseUrl || secretKeys.length === 0) {
    return json({ error: 'Billing reconciliation is not configured.' }, 500);
  }
  if (!paddleApiKey || !PADDLE_SANDBOX_KEY.test(paddleApiKey)) {
    return json({ error: 'Paddle sandbox reconciliation is dormant.' }, 503);
  }

  const admin = createClient(supabaseUrl, secretKeys[0], {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: runId, error: runError } = await admin.rpc(
    'begin_paddle_sandbox_reconciliation',
  );
  if (runError || !runId) {
    console.error('Unable to begin Paddle sandbox reconciliation.');
    return json({ error: 'Reconciliation could not start.' }, 500);
  }

  const { data: subscriptions, error: listError } = await admin.rpc(
    'list_paddle_sandbox_subscriptions_for_reconciliation',
    { batch_size: BATCH_SIZE },
  );
  if (listError) {
    await finishRun(admin, runId, {
      status: 'failed',
      checked: 0,
      updated: 0,
      failures: 0,
      errorCode: 'subscription_list_failed',
    });
    return json({ error: 'Reconciliation list failed.' }, 500);
  }

  const results = await runBounded(subscriptions ?? [], (subscription) =>
    reconcileOne(admin, paddleApiKey, subscription),
  );
  const failures = results.filter((result) => result.failed).length;
  const updated = results.filter((result) => result.updated).length;
  const status = failures === 0 ? 'succeeded' : 'partial';
  const finishError = (
    await finishRun(admin, runId, {
      status,
      checked: results.length,
      updated,
      failures,
      errorCode: failures > 0 ? 'item_failures' : null,
    })
  ).error;

  if (finishError) {
    console.error('Unable to finish Paddle sandbox reconciliation.');
    return json({ error: 'Reconciliation status could not be recorded.' }, 500);
  }

  return json({ checked: results.length, updated, failures, status });
});
