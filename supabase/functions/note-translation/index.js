/* global AbortSignal, Deno, Response, crypto, fetch */

// Translates one technician note on request and stores the translation next
// to the untouched original. Owners and office staff only.

import { createClient } from 'npm:@supabase/supabase-js@2';

import {
  ASSIST_MAX_COST_CENTS,
  ASSIST_MAX_OUTPUT_TOKENS,
  ASSIST_MODEL,
  TRANSLATION_SCHEMA,
  parseAssistResponse,
  sanitizeTranslation,
  translationInstructions,
} from '../_shared/ai-assist.js';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function bearerToken(request) {
  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return undefined;
  const token = authorization.slice('Bearer '.length);
  return token.length >= 20 && token.length <= 8192 ? token : undefined;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST')
    return json({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publicKey =
    Deno.env.get('SUPABASE_ANON_KEY') ??
    Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const secretKeys = configuredSecretKeys();
  if (!supabaseUrl || !publicKey || secretKeys.length === 0) {
    return json({ error: 'not_configured' }, 500);
  }

  const token = bearerToken(request);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const admin = createClient(supabaseUrl, secretKeys[0], {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json({ error: 'unauthorized' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }
  const targetLanguage = body?.targetLanguage === 'es' ? 'es' : 'en';
  if (!UUID.test(body?.noteId ?? ''))
    return json({ error: 'invalid_request' }, 400);

  const userClient = createClient(supabaseUrl, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { authorization: `Bearer ${token}` } },
  });
  const { data: prepared, error: prepareError } = await userClient.rpc(
    'prepare_note_translation',
    { target_note_id: body.noteId },
  );
  const note = Array.isArray(prepared) ? prepared[0] : undefined;
  if (prepareError || !note) return json({ error: 'unavailable' }, 422);

  const { data: runId, error: runError } = await admin.rpc(
    'begin_stub_ai_run',
    {
      target_actor_user_id: userData.user.id,
      target_agent_kind: 'translation',
      target_correlation_id: crypto.randomUUID(),
      target_policy_version: 'note-translation-v1',
      target_redacted_input_summary: `Translate technician note ${body.noteId} to ${targetLanguage}`,
      target_tenant_id: note.tenant_id,
    },
  );
  if (runError || !runId) {
    const message = String(runError?.message ?? '');
    return json(
      {
        error: message.includes('budget')
          ? 'budget_exhausted'
          : message.includes('disabled')
            ? 'ai_disabled'
            : 'unavailable',
      },
      422,
    );
  }

  const started = Date.now();
  const finish = (model, usage, code) =>
    admin.rpc('complete_ai_assist_run', {
      target_cost_cents: usage?.estimatedCostCents ?? 0,
      target_duration_ms: Date.now() - started,
      target_error_code: code,
      target_input_tokens: usage?.inputTokens ?? 0,
      target_model: model,
      target_output_tokens: usage?.outputTokens ?? 0,
      target_run_id: runId,
    });

  const apiKey = Deno.env.get('CREWFLOW_AI_PROVIDER_API_KEY')?.trim();
  if (!apiKey) {
    await finish(null, undefined, 'provider_not_configured');
    return json({ error: 'ai_unavailable' }, 503);
  }

  let usage;
  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        input: note.body,
        instructions: translationInstructions(targetLanguage),
        max_output_tokens: ASSIST_MAX_OUTPUT_TOKENS,
        metadata: { agent: 'translation', run_id: runId },
        model: ASSIST_MODEL,
        reasoning: { effort: 'none' },
        store: false,
        text: {
          format: {
            name: 'crewflow_note_translation',
            schema: TRANSLATION_SCHEMA,
            strict: true,
            type: 'json_schema',
          },
          verbosity: 'low',
        },
        tools: [],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    usage = response.ok
      ? parseAssistResponse(await response.json())
      : undefined;
  } catch {
    usage = undefined;
  }

  const translated = usage ? sanitizeTranslation(usage.output) : undefined;
  if (
    !usage ||
    !translated ||
    usage.estimatedCostCents > ASSIST_MAX_COST_CENTS
  ) {
    await finish(
      usage ? ASSIST_MODEL : null,
      usage,
      'provider_response_invalid',
    );
    return json({ error: 'ai_unavailable' }, 502);
  }

  const { error: finishError } = await finish(ASSIST_MODEL, usage, null);
  if (finishError) return json({ error: 'record_failed' }, 500);

  const { error: recordError } = await admin.rpc('record_note_translation', {
    target_language: targetLanguage,
    target_note_id: body.noteId,
    target_run_id: runId,
    target_text: translated.translation,
  });
  if (recordError) return json({ error: 'record_failed' }, 500);

  return json({
    sourceLanguage: translated.sourceLanguage,
    translation: translated.translation,
  });
});
