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
