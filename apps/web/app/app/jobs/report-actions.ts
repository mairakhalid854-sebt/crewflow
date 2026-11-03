'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { appUrl } from '../../../lib/app-url';
import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { requestLinkEmail } from '../../../lib/email/link-email';
import { createClient } from '../../../lib/supabase/server';

export interface WorkReportActionState {
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  readonly message?: string;
  readonly reportId?: string;
  readonly shareUrl?: string;
  readonly status: 'idle' | 'error' | 'success';
}

const reportSchema = z.object({
  jobId: z.uuid('Invalid job.'),
  partsUsed: z.string().trim().max(5000, 'Parts used is too long.'),
  recommendations: z.string().trim().max(5000, 'Recommendations are too long.'),
  summary: z.string().trim().min(1, 'Add a customer-facing summary.').max(5000),
  workPerformed: z
    .string()
    .trim()
    .min(1, 'Describe the work performed.')
    .max(10_000),
});

interface ReportProposalResult {
  readonly proposal_result: 'escalated' | 'proposed' | 'unchanged';
  readonly provider_reviewed: boolean;
  readonly result_message?: string;
}

function parseReportProposalResult(
  value: unknown,
): ReportProposalResult | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    !['escalated', 'proposed', 'unchanged'].includes(
      String(candidate.proposal_result),
    ) ||
    typeof candidate.provider_reviewed !== 'boolean' ||
    (candidate.result_message !== undefined &&
      typeof candidate.result_message !== 'string')
  ) {
    return undefined;
  }
  return candidate as unknown as ReportProposalResult;
}

function databaseMessage(detail?: string): string {
  const normalized = detail?.toLowerCase() ?? '';
  if (normalized.includes('fields are invalid')) {
    return 'One or more report fields are invalid.';
  }
  if (normalized.includes('unavailable')) {
    return 'This job must be completed before a work report can be prepared.';
  }
  return 'Work report could not be saved. Please try again.';
}

export async function requestAiReportProposalAction(
  _previousState: WorkReportActionState,
  formData: FormData,
): Promise<WorkReportActionState> {
  await requireTenantContext(['owner', 'office']);
  const parsedJobId = z.uuid().safeParse(formData.get('jobId'));
  if (!parsedJobId.success) {
    return { message: 'Job could not be identified.', status: 'error' };
  }

  const supabase = await createClient();
  const correlationId = crypto.randomUUID();
  const invocation: unknown = await supabase.functions.invoke(
    'report-openai-proposal',
    {
      body: {
        correlationId,
        jobId: parsedJobId.data,
        proposalType: 'report',
      },
    },
  );
  const invoked = invocation as
    { data?: unknown; error?: unknown } | null | undefined;
  let result = invoked?.error
    ? undefined
    : parseReportProposalResult(invoked?.data);
  let fallbackError: { message: string } | null = null;

  if (!result) {
    const fallback = await supabase.rpc('request_report_proposal', {
      target_correlation_id: correlationId,
      target_job_id: parsedJobId.data,
    });
    fallbackError = fallback.error;
    if (fallback.data?.[0]) {
      result = parseReportProposalResult({
        ...fallback.data[0],
        provider_reviewed: false,
      });
    }
  }

  if (fallbackError || !result) {
    return {
      message:
        'AI report evaluation could not finish. Check AI settings, job status, technician notes, and subscription access.',
      status: 'error',
    };
  }

  revalidatePath('/app/ai');
  revalidatePath(`/app/jobs/${parsedJobId.data}`);
  return {
    message:
      result.proposal_result === 'proposed'
        ? result.provider_reviewed
          ? 'Report proposal and bounded AI review recorded. Review it in AI Operations before approving.'
          : 'Report proposal created from trusted evidence. AI review was unavailable, so the deterministic proposal was kept.'
        : result.proposal_result === 'unchanged'
          ? 'The existing report draft already matches the trusted evidence.'
          : result.provider_reviewed
            ? 'Report drafting needs human input. The AI-reviewed escalation is recorded in AI Operations.'
            : (result.result_message ??
              'Report drafting needs human input. Review the trace in AI Operations.'),
    status: result.proposal_result === 'escalated' ? 'error' : 'success',
  };
}

export async function saveWorkReportAction(
  _previousState: WorkReportActionState,
  formData: FormData,
): Promise<WorkReportActionState> {
  const parsed = reportSchema.safeParse({
    jobId: formData.get('jobId'),
    partsUsed: formData.get('partsUsed'),
    recommendations: formData.get('recommendations'),
    summary: formData.get('summary'),
    workPerformed: formData.get('workPerformed'),
  });
  if (!parsed.success) {
    return {
      fieldErrors: parsed.error.flatten().fieldErrors,
      message: 'Please correct the highlighted fields.',
      status: 'error',
    };
  }

  await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('save_job_work_report', {
    report_parts_used: parsed.data.partsUsed,
    report_recommendations: parsed.data.recommendations,
    report_summary: parsed.data.summary,
    report_work_performed: parsed.data.workPerformed,
    target_job_id: parsed.data.jobId,
  });
  if (error) {
    return { message: databaseMessage(error.message), status: 'error' };
  }

  revalidatePath(`/app/jobs/${parsed.data.jobId}`);
  revalidatePath(`/app/jobs/${parsed.data.jobId}/report`);
  return {
    message: 'Draft report saved. Return to the job to review and approve it.',
    reportId: data,
    status: 'success',
  };
}

export async function publishWorkReportAction(
  _previousState: WorkReportActionState,
  formData: FormData,
): Promise<WorkReportActionState> {
  const parsed = z.object({ jobId: z.uuid(), reportId: z.uuid() }).safeParse({
    jobId: formData.get('jobId'),
    reportId: formData.get('reportId'),
  });
  if (!parsed.success) {
    return { message: 'Invalid work report.', status: 'error' };
  }

  await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const { data: token, error } = await supabase.rpc('publish_job_work_report', {
    target_report_id: parsed.data.reportId,
  });
  if (error) {
    return { message: databaseMessage(error.message), status: 'error' };
  }

  const emailMessage =
    formData.get('emailLink') === 'on'
      ? ` ${await requestLinkEmail(supabase, 'work_report', parsed.data.reportId, token)}`
      : '';

  revalidatePath(`/app/jobs/${parsed.data.jobId}`);
  return {
    message: `Report approved. Copy this secure customer link now.${emailMessage}`,
    shareUrl: `${appUrl()}/report/${token}`,
    status: 'success',
  };
}
