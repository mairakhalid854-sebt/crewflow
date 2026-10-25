'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { createClient } from '../../../lib/supabase/server';

export interface ApprovalDecisionState {
  readonly message?: string;
  readonly status: 'idle' | 'error' | 'success';
}

const decisionSchema = z.object({
  acknowledged: z.literal('on'),
  approvalId: z.uuid(),
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().trim().min(3).max(500),
});
const executionSchema = z.object({ approvalId: z.uuid() });

async function executeDispatcherApproval(
  approvalId: string,
): Promise<ApprovalDecisionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    'execute_approved_dispatcher_assignment',
    { target_approval_id: approvalId },
  );

  revalidatePath('/app/ai');
  revalidatePath('/app/ai/dispatcher');
  revalidatePath('/app/dispatch');
  revalidatePath('/app/jobs');

  if (error) {
    return {
      message:
        'Guarded execution could not finish. The approval is retained; refresh and retry execution.',
      status: 'error',
    };
  }

  return {
    message:
      data?.[0]?.result_message ??
      'Approval was recorded and guarded execution completed.',
    status: 'success',
  };
}

export async function decideApprovalAction(
  _previousState: ApprovalDecisionState,
  formData: FormData,
): Promise<ApprovalDecisionState> {
  const context = await requireTenantContext(['owner', 'office']);
  const parsed = decisionSchema.safeParse({
    acknowledged: formData.get('acknowledged'),
    approvalId: formData.get('approvalId'),
    decision: formData.get('decision'),
    reason: formData.get('reason'),
  });

  if (!parsed.success) {
    return {
      message:
        'Review the exact change, confirm the checkbox, and add a short decision reason.',
      status: 'error',
    };
  }

  const supabase = await createClient();
  const { data: approval, error: approvalError } = await supabase
    .from('ai_approval_requests')
    .select('action_kind')
    .eq('id', parsed.data.approvalId)
    .eq('tenant_id', context.tenantId)
    .single();

  if (approvalError || !approval) {
    return {
      message: 'This approval request is no longer available.',
      status: 'error',
    };
  }

  const { data, error } = await supabase.rpc('decide_ai_approval', {
    target_approval_id: parsed.data.approvalId,
    target_decision: parsed.data.decision,
    target_reason: parsed.data.reason,
  });

  if (error) {
    return {
      message:
        'This request could not be decided. It may have expired or already been reviewed.',
      status: 'error',
    };
  }

  if (
    data === 'approved' &&
    approval.action_kind === 'dispatcher.assign_technician'
  ) {
    return executeDispatcherApproval(parsed.data.approvalId);
  }

  revalidatePath('/app/ai');
  return {
    message:
      data === 'expired'
        ? 'This request expired before the decision and was not authorized.'
        : data === 'approved'
          ? 'Approval recorded.'
          : 'Rejection recorded. No action will be executed.',
    status: 'success',
  };
}

export async function retryDispatcherExecutionAction(
  _previousState: ApprovalDecisionState,
  formData: FormData,
): Promise<ApprovalDecisionState> {
  const context = await requireTenantContext(['owner', 'office']);
  const parsed = executionSchema.safeParse({
    approvalId: formData.get('approvalId'),
  });
  if (!parsed.success) {
    return { message: 'Approval could not be identified.', status: 'error' };
  }

  const supabase = await createClient();
  const { data: approval, error } = await supabase
    .from('ai_approval_requests')
    .select('action_kind,status,execution_status')
    .eq('id', parsed.data.approvalId)
    .eq('tenant_id', context.tenantId)
    .single();

  if (
    error ||
    !approval ||
    approval.action_kind !== 'dispatcher.assign_technician' ||
    approval.status !== 'approved'
  ) {
    return {
      message: 'This Dispatcher approval is not available for execution.',
      status: 'error',
    };
  }

  return executeDispatcherApproval(parsed.data.approvalId);
}
