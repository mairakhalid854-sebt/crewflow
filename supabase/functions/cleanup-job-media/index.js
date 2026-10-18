/* global Deno, Response, TextEncoder, console, crypto */

import { createClient } from 'npm:@supabase/supabase-js@2';

const BATCH_SIZE = 100;
const BUCKET = 'job-media';

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
    return json({ error: 'Cleanup service is not configured.' }, 500);
  }

  const admin = createClient(supabaseUrl, adminKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: claimed, error: claimError } = await admin.rpc(
    'claim_expired_job_media_cleanup',
    { batch_size: BATCH_SIZE },
  );

  if (claimError) {
    console.error('Unable to claim expired job media.', claimError);
    return json({ error: 'Cleanup claim failed.' }, 500);
  }

  if (!claimed || claimed.length === 0) {
    return json({ claimed: 0, deleted: 0 });
  }

  const storagePaths = claimed.map((media) => media.storage_path);
  const mediaIds = claimed.map((media) => media.media_id);
  const { error: storageError } = await admin.storage
    .from(BUCKET)
    .remove(storagePaths);

  if (storageError) {
    console.error('Unable to remove expired job media objects.', storageError);
    return json(
      {
        claimed: claimed.length,
        deleted: 0,
        error: 'Storage cleanup failed; the claim will retry automatically.',
      },
      502,
    );
  }

  const { data: deleted, error: completionError } = await admin.rpc(
    'complete_expired_job_media_cleanup',
    { target_media_ids: mediaIds },
  );

  if (completionError) {
    console.error(
      'Unable to complete expired job media cleanup.',
      completionError,
    );
    return json(
      {
        claimed: claimed.length,
        deleted: 0,
        error: 'Metadata cleanup failed and will be retried.',
      },
      500,
    );
  }

  return json({ claimed: claimed.length, deleted: deleted ?? 0 });
});
