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

export async function decideApprovalAction(
  _previousState: ApprovalDecisionState,
  formData: FormData,
): Promise<ApprovalDecisionState> {
  await requireTenantContext(['owner', 'office']);
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

  revalidatePath('/app/ai');
  return {
    message:
      data === 'expired'
        ? 'This request expired before the decision and was not authorized.'
        : data === 'approved'
          ? 'Approval recorded. The guarded executor must still revalidate current state before any effect.'
          : 'Rejection recorded. No action will be executed.',
    status: 'success',
  };
}
