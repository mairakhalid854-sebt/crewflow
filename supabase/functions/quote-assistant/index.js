/* global AbortSignal, Deno, Response, console, crypto, fetch */

// Drafts quote lines from office notes. The model may only choose service IDs
// from the workspace's enabled catalog; prices come from the database. The
// draft is saved for a person to review; nothing is sent to the customer.

import { createClient } from 'npm:@supabase/supabase-js@2';

import {
  ASSIST_MAX_COST_CENTS,
  ASSIST_MAX_OUTPUT_TOKENS,
  ASSIST_MODEL,
  QUOTE_INSTRUCTIONS,
  parseAssistResponse,
  quoteDraftSchema,
  sanitizeQuoteDraft,
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

function errorCode(error) {
  const message = String(error?.message ?? '');
  if (message.includes('budget')) return 'budget_exhausted';
  if (message.includes('disabled')) return 'ai_disabled';
  if (message.includes('price list')) return 'no_catalog';
  if (message.includes('new or quoted')) return 'job_not_quotable';
  return 'unavailable';
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
  const notes = typeof body?.notes === 'string' ? body.notes.trim() : '';
  if (
    !UUID.test(body?.jobId ?? '') ||
    notes.length < 10 ||
    notes.length > 4000
  ) {
    return json({ error: 'invalid_request' }, 400);
  }

  const userClient = createClient(supabaseUrl, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { authorization: `Bearer ${token}` } },
  });
  const { data: prepared, error: prepareError } = await userClient.rpc(
    'prepare_ai_quote_draft',
    { target_job_id: body.jobId, target_notes: notes },
  );
  const context = Array.isArray(prepared) ? prepared[0] : undefined;
  if (prepareError || !context) {
    return json({ error: errorCode(prepareError) }, 422);
  }
  const catalog = Array.isArray(context.catalog) ? context.catalog : [];
  const serviceIds = catalog
    .map((service) => service.id)
    .filter((id) => UUID.test(id));

  const { data: runId, error: runError } = await admin.rpc(
    'begin_stub_ai_run',
    {
      target_actor_user_id: userData.user.id,
      target_agent_kind: 'quote_assistant',
      target_correlation_id: crypto.randomUUID(),
      target_policy_version: 'quote-assistant-v1',
      target_redacted_input_summary: `Quote draft from office notes for job ${body.jobId}`,
      target_tenant_id: context.tenant_id,
    },
  );
  if (runError || !runId) return json({ error: errorCode(runError) }, 422);

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

  const started = Date.now();
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
        input: JSON.stringify({ catalog, jobTitle: context.job_title, notes }),
        instructions: QUOTE_INSTRUCTIONS,
        max_output_tokens: ASSIST_MAX_OUTPUT_TOKENS,
        metadata: { agent: 'quote_assistant', run_id: runId },
        model: ASSIST_MODEL,
        reasoning: { effort: 'none' },
        store: false,
        text: {
          format: {
            name: 'crewflow_quote_draft',
            schema: quoteDraftSchema(serviceIds),
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

  if (!usage || usage.estimatedCostCents > ASSIST_MAX_COST_CENTS) {
    await finish(
      usage ? ASSIST_MODEL : null,
      usage,
      'provider_response_invalid',
    );
    return json({ error: 'ai_unavailable' }, 502);
  }

  const { error: finishError } = await finish(ASSIST_MODEL, usage, null);
  if (finishError) {
    console.error(
      JSON.stringify({
        event: 'quote_assistant_finish_failed',
        code: finishError.code,
      }),
    );
    return json({ error: 'record_failed' }, 500);
  }

  const draft = sanitizeQuoteDraft(usage.output, serviceIds);
  const { data: draftId, error: recordError } = await admin.rpc(
    'record_ai_quote_draft',
    {
      target_job_id: body.jobId,
      target_lines: draft.lines,
      target_missing_information: draft.missingInformation,
      target_run_id: runId,
      target_summary: draft.summary,
    },
  );
  if (recordError || !draftId) {
    console.error(
      JSON.stringify({
        event: 'quote_draft_record_failed',
        code: recordError?.code,
      }),
    );
    return json({ error: 'record_failed' }, 500);
  }

  return json({ draftId, lineCount: draft.lines.length });
});
