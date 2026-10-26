/* global Deno, Response, TextEncoder, btoa, crypto, console */

import { createClient } from 'npm:@supabase/supabase-js@2';

import { advanceIntakeSession } from '../_shared/intake-policy.ts';

const corsHeaders = {
  'access-control-allow-headers': 'content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-origin': '*',
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
};
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body, status = 200, correlationId = crypto.randomUUID()) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'x-correlation-id': correlationId },
  });
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function constantTimeEqual(left, right) {
  if (
    typeof left !== 'string' ||
    typeof right !== 'string' ||
    left.length !== right.length
  ) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function publicStatus(status) {
  return status === 'human_takeover' ? 'escalated' : status;
}

function services(snapshot) {
  if (!Array.isArray(snapshot)) return [];
  return snapshot
    .filter(
      (item) =>
        item && typeof item.id === 'string' && typeof item.name === 'string',
    )
    .map((item) => ({
      description:
        typeof item.description === 'string' ? item.description : undefined,
      enabled: true,
      id: item.id,
      name: item.name,
      unitPriceCents:
        typeof item.unitPriceCents === 'number'
          ? item.unitPriceCents
          : undefined,
    }));
}

function safeMessage(value) {
  return typeof value === 'string' && value.trim().length <= 4000
    ? value.trim()
    : undefined;
}

function databaseErrorStatus(error) {
  const message = error?.message ?? '';
  if (message.includes('rate limit')) return 429;
  if (message.includes('expired')) return 410;
  if (message.includes('unavailable')) return 404;
  if (message.includes('no longer collecting')) return 409;
  if (message.includes('slot') || message.includes('already selected'))
    return 409;
  return 400;
}

function validSessionRequest(body) {
  return (
    typeof body.conversationId === 'string' &&
    uuidPattern.test(body.conversationId) &&
    typeof body.sessionToken === 'string' &&
    body.sessionToken.length >= 43 &&
    body.sessionToken.length <= 256
  );
}

async function startConversation(admin, body, correlationId) {
  if (typeof body.widgetKey !== 'string' || !uuidPattern.test(body.widgetKey)) {
    return json({ error: 'Invalid intake link.' }, 400, correlationId);
  }

  const sessionToken = randomToken();
  const { data: conversationId, error: openError } = await admin.rpc(
    'open_intake_conversation',
    { session_token: sessionToken, target_widget_key: body.widgetKey },
  );

  if (openError || typeof conversationId !== 'string') {
    if (openError && databaseErrorStatus(openError) >= 500) {
      console.error('Unable to open intake conversation.', { correlationId });
    }
    return json(
      {
        error: openError?.message?.includes('rate limit')
          ? 'Too many new conversations. Please try again shortly.'
          : 'This intake form is not available.',
      },
      openError?.message?.includes('rate limit') ? 429 : 404,
      correlationId,
    );
  }

  const { data: conversation, error: readError } = await admin
    .from('intake_conversations')
    .select('expires_at,stage,status,version')
    .eq('id', conversationId)
    .maybeSingle();

  if (readError || !conversation) {
    console.error('Unable to read opened intake conversation.', {
      correlationId,
    });
    return json({ error: 'Unable to start intake.' }, 500, correlationId);
  }

  return json(
    {
      conversationId,
      expiresAt: conversation.expires_at,
      message: 'What is your full name?',
      sessionToken,
      stage: conversation.stage,
      status: publicStatus(conversation.status),
      version: conversation.version,
    },
    201,
    correlationId,
  );
}

async function continueConversation(admin, body, correlationId) {
  const message = safeMessage(body.message);
  if (
    typeof body.conversationId !== 'string' ||
    !uuidPattern.test(body.conversationId) ||
    typeof body.sessionToken !== 'string' ||
    body.sessionToken.length < 43 ||
    body.sessionToken.length > 256 ||
    !message
  ) {
    return json({ error: 'Invalid intake request.' }, 400, correlationId);
  }

  const { data: conversation, error: readError } = await admin
    .from('intake_conversations')
    .select(
      'catalog_snapshot,collected_values,expires_at,session_token_hash,stage,status,version',
    )
    .eq('id', body.conversationId)
    .maybeSingle();

  if (readError || !conversation) {
    return json(
      { error: 'Intake conversation not found.' },
      404,
      correlationId,
    );
  }

  const suppliedHash = await sha256Hex(body.sessionToken);
  if (!constantTimeEqual(suppliedHash, conversation.session_token_hash)) {
    return json(
      { error: 'Intake conversation not found.' },
      404,
      correlationId,
    );
  }

  if (new Date(conversation.expires_at).getTime() <= Date.now()) {
    return json(
      { error: 'This intake conversation has expired.' },
      410,
      correlationId,
    );
  }

  if (conversation.status !== 'collecting') {
    return json(
      {
        error: 'This conversation is waiting for the office team.',
        stage: conversation.stage,
        status: publicStatus(conversation.status),
      },
      409,
      correlationId,
    );
  }

  const turn = advanceIntakeSession(
    {
      stage: conversation.stage,
      status: 'collecting',
      values: conversation.collected_values ?? {},
    },
    message,
    services(conversation.catalog_snapshot),
  );
  const assistantMessage = turn.question ?? 'A team member will follow up.';
  const rpcName = turn.error
    ? 'record_intake_validation_error'
    : 'record_intake_turn';
  const rpcArguments = turn.error
    ? {
        assistant_message: assistantMessage,
        customer_message: message,
        session_token: body.sessionToken,
        target_conversation_id: body.conversationId,
      }
    : {
        assistant_message: assistantMessage,
        customer_message: message,
        next_collected_values: turn.session.values,
        next_stage: turn.session.stage,
        next_status:
          turn.session.status === 'escalated'
            ? 'human_takeover'
            : turn.session.status,
        session_token: body.sessionToken,
        target_conversation_id: body.conversationId,
        target_escalation_reason: turn.session.escalationReason ?? null,
        target_selected_service_id: turn.session.values.serviceId ?? null,
      };
  const { data: version, error: recordError } = await admin.rpc(
    rpcName,
    rpcArguments,
  );

  if (recordError) {
    const status = databaseErrorStatus(recordError);
    if (status >= 500) {
      console.error('Unable to record intake turn.', { correlationId });
    }
    return json(
      {
        error:
          status === 429
            ? 'Too many messages. Please wait a moment.'
            : 'Unable to save this message.',
      },
      status,
      correlationId,
    );
  }

  return json(
    {
      error: turn.error,
      message: assistantMessage,
      stage: turn.session.stage,
      status: turn.session.status,
      version,
    },
    200,
    correlationId,
  );
}

async function readSlotStatus(admin, body, correlationId) {
  if (!validSessionRequest(body)) {
    return json({ error: 'Invalid intake request.' }, 400, correlationId);
  }

  const { data, error } = await admin.rpc('get_public_intake_slot_status', {
    session_token: body.sessionToken,
    target_conversation_id: body.conversationId,
  });
  if (error || !data || typeof data !== 'object') {
    const status = databaseErrorStatus(error);
    return json(
      {
        error:
          status === 410
            ? 'This intake conversation has expired.'
            : 'Unable to check this service request.',
      },
      status,
      correlationId,
    );
  }
  return json(data, 200, correlationId);
}

async function selectSlot(admin, body, correlationId) {
  if (
    !validSessionRequest(body) ||
    typeof body.offerId !== 'string' ||
    !uuidPattern.test(body.offerId)
  ) {
    return json({ error: 'Invalid slot selection.' }, 400, correlationId);
  }

  const { data, error } = await admin.rpc('select_public_intake_slot', {
    session_token: body.sessionToken,
    target_conversation_id: body.conversationId,
    target_offer_id: body.offerId,
  });
  if (error) {
    const status = databaseErrorStatus(error);
    return json(
      {
        error:
          status === 410
            ? 'This intake conversation has expired.'
            : status === 409
              ? 'That slot is no longer available. Ask the office for new options.'
              : 'Unable to save this slot selection.',
      },
      status,
      correlationId,
    );
  }
  return json(
    {
      message:
        'Your preferred time was sent to the office. It is not booked until they confirm it.',
      selectionResult: data,
    },
    200,
    correlationId,
  );
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405);
  }

  const correlationId = crypto.randomUUID();
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 10_000) {
    return json({ error: 'Request is too large.' }, 413, correlationId);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400, correlationId);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Public intake service is not configured.', {
      correlationId,
    });
    return json({ error: 'Intake service unavailable.' }, 503, correlationId);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (body?.action === 'start') {
    return startConversation(admin, body, correlationId);
  }
  if (body?.action === 'message') {
    return continueConversation(admin, body, correlationId);
  }
  if (body?.action === 'status') {
    return readSlotStatus(admin, body, correlationId);
  }
  if (body?.action === 'select_slot') {
    return selectSlot(admin, body, correlationId);
  }
  return json({ error: 'Unsupported intake action.' }, 400, correlationId);
});
