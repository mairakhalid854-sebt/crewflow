'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { createClient } from '../../../lib/supabase/server';

export interface IntakeActionState {
  readonly message?: string;
  readonly status: 'idle' | 'error' | 'success';
}

const conversationIdSchema = z.uuid();

interface IntakeProposalResult {
  readonly proposal_result: 'escalated' | 'proposed';
  readonly provider_reviewed: boolean;
  readonly result_message?: string;
}

function parseIntakeProposalResult(
  value: unknown,
): IntakeProposalResult | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    !['escalated', 'proposed'].includes(String(candidate.proposal_result)) ||
    typeof candidate.provider_reviewed !== 'boolean' ||
    (candidate.result_message !== undefined &&
      typeof candidate.result_message !== 'string')
  ) {
    return undefined;
  }
  return candidate as unknown as IntakeProposalResult;
}

export async function setIntakeWidgetEnabledAction(
  _previousState: IntakeActionState,
  formData: FormData,
): Promise<IntakeActionState> {
  const context = await requireTenantContext(['owner']);
  const enabled = formData.get('enabled') === 'true';
  const supabase = await createClient();
  const { error } = await supabase
    .from('tenant_settings')
    .update({ intake_widget_enabled: enabled })
    .eq('tenant_id', context.tenantId);

  if (error) {
    return {
      message: 'Intake widget setting could not be changed.',
      status: 'error',
    };
  }

  revalidatePath('/app/intake');
  return {
    message: enabled
      ? 'Public Intake is enabled.'
      : 'Public Intake is disabled. Existing records remain available.',
    status: 'success',
  };
}

export async function takeOverIntakeConversationAction(
  _previousState: IntakeActionState,
  formData: FormData,
): Promise<IntakeActionState> {
  await requireTenantContext(['owner', 'office']);
  const parsedId = conversationIdSchema.safeParse(
    formData.get('conversationId'),
  );
  if (!parsedId.success) {
    return {
      message: 'Conversation could not be identified.',
      status: 'error',
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('take_over_intake_conversation', {
    takeover_reason: 'Office accepted the conversation from the Intake inbox.',
    target_conversation_id: parsedId.data,
  });

  if (error) {
    return {
      message: 'Conversation could not be taken over.',
      status: 'error',
    };
  }

  revalidatePath('/app/intake');
  return { message: 'Conversation assigned to the office.', status: 'success' };
}

export async function requestIntakeDraftProposalAction(
  _previousState: IntakeActionState,
  formData: FormData,
): Promise<IntakeActionState> {
  await requireTenantContext(['owner', 'office']);
  const parsedId = conversationIdSchema.safeParse(
    formData.get('conversationId'),
  );
  if (!parsedId.success) {
    return {
      message: 'Conversation could not be identified.',
      status: 'error',
    };
  }

  const supabase = await createClient();
  const correlationId = crypto.randomUUID();
  const invocation: unknown = await supabase.functions.invoke(
    'intake-openai-proposal',
    {
      body: {
        conversationId: parsedId.data,
        correlationId,
      },
    },
  );
  const invoked = invocation as
    { data?: unknown; error?: unknown } | null | undefined;
  let result = invoked?.error
    ? undefined
    : parseIntakeProposalResult(invoked?.data);
  let fallbackError: { message: string } | null = null;

  if (!result) {
    const fallback = await supabase.rpc('request_intake_quote_slot_proposal', {
      target_conversation_id: parsedId.data,
      target_correlation_id: correlationId,
    });
    fallbackError = fallback.error;
    const deterministic = fallback.data?.[0];
    if (deterministic) {
      result = parseIntakeProposalResult({
        ...deterministic,
        provider_reviewed: false,
      });
    }
  }

  if (fallbackError || !result) {
    return {
      message:
        'Proposal could not be prepared. Check AI settings, subscription access, service coverage, and technician availability.',
      status: 'error',
    };
  }

  revalidatePath('/app/intake');
  revalidatePath('/app/ai');
  return {
    message: result.provider_reviewed
      ? result.proposal_result === 'proposed'
        ? 'Intake proposal and bounded AI review recorded. Office approval is still required before any records are created.'
        : 'Two verified slots were unavailable. The AI-reviewed escalation is recorded; schedule manually.'
      : (result.result_message ?? 'Intake proposal evaluation completed.'),
    status: result.proposal_result === 'escalated' ? 'error' : 'success',
  };
}

export async function confirmIntakeSelectedSlotAction(
  _previousState: IntakeActionState,
  formData: FormData,
): Promise<IntakeActionState> {
  await requireTenantContext(['owner', 'office']);
  const parsedId = conversationIdSchema.safeParse(
    formData.get('conversationId'),
  );
  if (!parsedId.success) {
    return {
      message: 'Conversation could not be identified.',
      status: 'error',
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('confirm_intake_selected_slot', {
    target_conversation_id: parsedId.data,
  });
  if (error) {
    return {
      message:
        'Booking could not be confirmed. Ensure the customer accepted the quote and the technician is still available.',
      status: 'error',
    };
  }

  revalidatePath('/app/intake');
  revalidatePath('/app/jobs');
  revalidatePath('/app/dispatch');
  return {
    message: data?.[0]?.result_message ?? 'Customer-selected slot confirmed.',
    status: 'success',
  };
}

export async function requestIntakeReplacementSlotsAction(
  _previousState: IntakeActionState,
  formData: FormData,
): Promise<IntakeActionState> {
  await requireTenantContext(['owner', 'office']);
  const parsedId = conversationIdSchema.safeParse(
    formData.get('conversationId'),
  );
  if (!parsedId.success) {
    return {
      message: 'Conversation could not be identified.',
      status: 'error',
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    'request_intake_replacement_slots',
    { target_conversation_id: parsedId.data },
  );
  if (error || data?.[0]?.replacement_result !== 'replaced') {
    return {
      message:
        'New options could not be prepared. Check service coverage, availability, and the replacement limit.',
      status: 'error',
    };
  }

  revalidatePath('/app/intake');
  return {
    message: data[0].result_message,
    status: 'success',
  };
}
