'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { appUrl } from '../../../lib/app-url';
import { requireTenantContext } from '../../../lib/auth/tenant-context';
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

  revalidatePath(`/app/jobs/${parsed.data.jobId}`);
  return {
    message: 'Report approved. Copy this secure customer link now.',
    shareUrl: `${appUrl()}/report/${token}`,
    status: 'success',
  };
}
