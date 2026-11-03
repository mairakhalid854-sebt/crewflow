/* global Deno, Response, TextEncoder, console, crypto, fetch */

import { createClient } from 'npm:@supabase/supabase-js@2';

const BATCH_SIZE = 100;
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

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

function messageFor(delivery) {
  return {
    to: delivery.expo_push_token,
    title: delivery.title,
    body: delivery.body,
    sound: 'default',
    priority: 'high',
    channelId: 'crewflow-operations',
    data: {
      deepLink: delivery.deep_link,
      kind: delivery.notification_kind,
    },
  };
}

function safeExpoErrorCode(ticket) {
  const value = ticket?.details?.error;
  return typeof value === 'string' && value.length > 0
    ? `expo_${value}`
    : 'expo_rejected';
}

async function retryDeliveries(admin, deliveryIds, errorCode) {
  if (deliveryIds.length === 0) return undefined;
  return admin.rpc('retry_push_notification_deliveries', {
    target_delivery_ids: deliveryIds,
    error_code: errorCode,
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
  const adminKey = secretKeys[0];
  if (!supabaseUrl || !adminKey) {
    return json({ error: 'Push delivery service is not configured.' }, 500);
  }

  const admin = createClient(supabaseUrl, adminKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: claimed, error: claimError } = await admin.rpc(
    'claim_push_notification_deliveries',
    { batch_size: BATCH_SIZE },
  );

  if (claimError) {
    console.error('Unable to claim push notification deliveries.');
    return json({ error: 'Push delivery claim failed.' }, 500);
  }

  if (!claimed || claimed.length === 0) {
    return json({ claimed: 0, sent: 0, retried: 0, disabled: 0 });
  }

  const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  let response;
  try {
    response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'accept-encoding': 'gzip, deflate',
        'content-type': 'application/json',
        ...(expoAccessToken
          ? { authorization: `Bearer ${expoAccessToken}` }
          : {}),
      },
      body: JSON.stringify(claimed.map(messageFor)),
    });
  } catch {
    await retryDeliveries(
      admin,
      claimed.map((delivery) => delivery.delivery_id),
      'expo_network_error',
    );
    return json(
      {
        claimed: claimed.length,
        sent: 0,
        retried: claimed.length,
        disabled: 0,
      },
      502,
    );
  }

  if (!response.ok) {
    await retryDeliveries(
      admin,
      claimed.map((delivery) => delivery.delivery_id),
      `expo_http_${response.status}`,
    );
    return json(
      {
        claimed: claimed.length,
        sent: 0,
        retried: claimed.length,
        disabled: 0,
      },
      502,
    );
  }

  let tickets;
  try {
    const payload = await response.json();
    tickets = Array.isArray(payload?.data) ? payload.data : undefined;
  } catch {
    tickets = undefined;
  }

  if (!tickets || tickets.length !== claimed.length) {
    await retryDeliveries(
      admin,
      claimed.map((delivery) => delivery.delivery_id),
      'expo_invalid_response',
    );
    return json(
      {
        claimed: claimed.length,
        sent: 0,
        retried: claimed.length,
        disabled: 0,
      },
      502,
    );
  }

  const completedIds = [];
  const invalidTokens = [];
  const retryGroups = new Map();

  tickets.forEach((ticket, index) => {
    const delivery = claimed[index];
    if (!delivery) return;
    if (ticket?.status === 'ok') {
      completedIds.push(delivery.delivery_id);
      return;
    }

    const errorCode = safeExpoErrorCode(ticket);
    if (ticket?.details?.error === 'DeviceNotRegistered') {
      invalidTokens.push(delivery.expo_push_token);
      completedIds.push(delivery.delivery_id);
      return;
    }

    retryGroups.set(errorCode, [
      ...(retryGroups.get(errorCode) ?? []),
      delivery.delivery_id,
    ]);
  });

  if (invalidTokens.length > 0) {
    const { error } = await admin.rpc('disable_invalid_mobile_push_tokens', {
      invalid_expo_push_tokens: invalidTokens,
    });
    if (error) {
      console.error('Unable to disable invalid mobile push tokens.');
      return json({ error: 'Push token cleanup failed.' }, 500);
    }
  }

  if (completedIds.length > 0) {
    const { error } = await admin.rpc('complete_push_notification_deliveries', {
      target_delivery_ids: completedIds,
    });
    if (error) {
      console.error('Unable to complete push notification deliveries.');
      return json({ error: 'Push delivery completion failed.' }, 500);
    }
  }

  let retried = 0;
  for (const [errorCode, deliveryIds] of retryGroups) {
    const { error } = await retryDeliveries(admin, deliveryIds, errorCode);
    if (error) {
      console.error('Unable to schedule push notification retry.');
      return json({ error: 'Push delivery retry failed.' }, 500);
    }
    retried += deliveryIds.length;
  }

  return json({
    claimed: claimed.length,
    sent: completedIds.length,
    retried,
    disabled: invalidTokens.length,
  });
});
