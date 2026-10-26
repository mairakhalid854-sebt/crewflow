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
  const { data, error } = await supabase.rpc(
    'request_intake_quote_slot_proposal',
    {
      target_conversation_id: parsedId.data,
      target_correlation_id: crypto.randomUUID(),
    },
  );

  if (error) {
    return {
      message:
        'Proposal could not be prepared. Check AI settings, subscription access, service coverage, and technician availability.',
      status: 'error',
    };
  }

  revalidatePath('/app/intake');
  revalidatePath('/app/ai');
  return {
    message:
      data?.[0]?.result_message ?? 'Intake proposal evaluation completed.',
    status: data?.[0]?.proposal_result === 'escalated' ? 'error' : 'success',
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
