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

async function executeReportApproval(
  approvalId: string,
): Promise<ApprovalDecisionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('execute_approved_report_draft', {
    target_approval_id: approvalId,
  });

  revalidatePath('/app/ai');
  revalidatePath('/app/jobs');
  if (data?.[0]?.job_id) {
    revalidatePath(`/app/jobs/${data[0].job_id}`);
    revalidatePath(`/app/jobs/${data[0].job_id}/report`);
  }

  if (error) {
    return {
      message:
        'Guarded report save could not finish. The approval is retained; refresh and retry execution.',
      status: 'error',
    };
  }

  return {
    message:
      data?.[0]?.result_message ??
      'Approval was recorded and guarded report saving completed.',
    status: 'success',
  };
}

async function executeReportInvoiceApproval(
  approvalId: string,
): Promise<ApprovalDecisionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    'execute_approved_report_invoice_draft',
    { target_approval_id: approvalId },
  );

  revalidatePath('/app/ai');
  revalidatePath('/app/jobs');
  if (data?.[0]?.job_id) {
    revalidatePath(`/app/jobs/${data[0].job_id}`);
    revalidatePath(`/app/jobs/${data[0].job_id}/invoice`);
  }

  if (error) {
    return {
      message:
        'Guarded invoice save could not finish. The approval is retained; refresh and retry execution.',
      status: 'error',
    };
  }

  return {
    message:
      data?.[0]?.result_message ??
      'Approval was recorded and guarded invoice saving completed.',
    status: 'success',
  };
}

async function executeFollowUpApproval(
  approvalId: string,
): Promise<ApprovalDecisionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    'execute_approved_follow_up_message',
    { target_approval_id: approvalId },
  );

  revalidatePath('/app/ai');
  revalidatePath('/app/invoices');

  if (error) {
    return {
      message:
        'Guarded Follow-Up queueing could not finish. The approval is retained; refresh and retry execution.',
      status: 'error',
    };
  }

  return {
    message:
      data?.[0]?.result_message ??
      'Approval was recorded and guarded Follow-Up queueing completed.',
    status: 'success',
  };
}

async function executeIntakeApproval(
  approvalId: string,
): Promise<ApprovalDecisionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    'execute_approved_intake_draft_records',
    { target_approval_id: approvalId },
  );

  revalidatePath('/app/ai');
  revalidatePath('/app/intake');
  revalidatePath('/app/customers');
  revalidatePath('/app/jobs');
  if (data?.[0]?.job_id) {
    revalidatePath(`/app/jobs/${data[0].job_id}`);
    revalidatePath(`/app/jobs/${data[0].job_id}/quote`);
  }

  if (error) {
    return {
      message:
        'Guarded Intake draft creation could not finish. The approval is retained; refresh and retry execution.',
      status: 'error',
    };
  }

  return {
    message:
      data?.[0]?.result_message ??
      'Approval was recorded and guarded Intake draft creation completed.',
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

  if (data === 'approved' && approval.action_kind === 'report.save_draft') {
    return executeReportApproval(parsed.data.approvalId);
  }

  if (
    data === 'approved' &&
    approval.action_kind === 'report.save_invoice_draft'
  ) {
    return executeReportInvoiceApproval(parsed.data.approvalId);
  }

  if (
    data === 'approved' &&
    approval.action_kind === 'follow_up.queue_message'
  ) {
    return executeFollowUpApproval(parsed.data.approvalId);
  }

  if (
    data === 'approved' &&
    approval.action_kind === 'intake.create_draft_records'
  ) {
    return executeIntakeApproval(parsed.data.approvalId);
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

export async function retryReportExecutionAction(
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
    approval.action_kind !== 'report.save_draft' ||
    approval.status !== 'approved'
  ) {
    return {
      message: 'This Report approval is not available for execution.',
      status: 'error',
    };
  }

  return executeReportApproval(parsed.data.approvalId);
}

export async function retryReportInvoiceExecutionAction(
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
    approval.action_kind !== 'report.save_invoice_draft' ||
    approval.status !== 'approved'
  ) {
    return {
      message: 'This Report invoice approval is not available for execution.',
      status: 'error',
    };
  }

  return executeReportInvoiceApproval(parsed.data.approvalId);
}

export async function retryFollowUpExecutionAction(
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
    approval.action_kind !== 'follow_up.queue_message' ||
    approval.status !== 'approved'
  ) {
    return {
      message: 'This Follow-Up approval is not available for execution.',
      status: 'error',
    };
  }

  return executeFollowUpApproval(parsed.data.approvalId);
}

export async function retryIntakeExecutionAction(
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
    approval.action_kind !== 'intake.create_draft_records' ||
    approval.status !== 'approved'
  ) {
    return {
      message: 'This Intake approval is not available for execution.',
      status: 'error',
    };
  }

  return executeIntakeApproval(parsed.data.approvalId);
}
