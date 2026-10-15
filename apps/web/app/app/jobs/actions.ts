'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { localDateTimeToIso } from '../../../lib/date-time';
import { createClient } from '../../../lib/supabase/server';
import { nextJobStatuses } from './job-status';

export interface JobFormState {
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  readonly message?: string;
  readonly status: 'idle' | 'error' | 'success';
}

const optionalUuid = z.union([z.literal(''), z.uuid()]);
const jobSchema = z
  .object({
    assignedMembershipId: optionalUuid,
    customerId: z.uuid('Select a customer.'),
    description: z.string().trim().max(5000).default(''),
    priority: z.enum(['low', 'normal', 'high', 'urgent']),
    scheduledEndLocal: z.string().trim().default(''),
    scheduledStartLocal: z.string().trim().default(''),
    serviceId: optionalUuid,
    title: z.string().trim().min(2, 'Enter a job title.').max(160),
  })
  .refine(
    (job) =>
      Boolean(job.scheduledStartLocal) === Boolean(job.scheduledEndLocal),
    {
      message: 'Enter both a start and end time.',
      path: ['scheduledEndLocal'],
    },
  )
  .refine(
    (job) => !job.scheduledStartLocal || Boolean(job.assignedMembershipId),
    {
      message: 'Select a technician before adding a schedule.',
      path: ['assignedMembershipId'],
    },
  );

const jobIdSchema = z.uuid();
const jobStatusSchema = z.enum([
  'new',
  'quoted',
  'accepted',
  'scheduled',
  'in_progress',
  'completed',
  'closed',
  'cancelled',
]);

function nullable(value: string): string | null {
  return value === '' ? null : value;
}

function validationFailure(error: z.ZodError): JobFormState {
  return {
    fieldErrors: error.flatten().fieldErrors,
    message: 'Please correct the highlighted fields.',
    status: 'error',
  };
}

function readJob(formData: FormData) {
  return jobSchema.safeParse({
    assignedMembershipId: formData.get('assignedMembershipId'),
    customerId: formData.get('customerId'),
    description: formData.get('description'),
    priority: formData.get('priority'),
    scheduledEndLocal: formData.get('scheduledEndLocal'),
    scheduledStartLocal: formData.get('scheduledStartLocal'),
    serviceId: formData.get('serviceId'),
    title: formData.get('title'),
  });
}

function scheduleValues(
  startLocal: string,
  endLocal: string,
  timeZone: string,
):
  | { readonly end: null; readonly start: null }
  | { readonly end: string; readonly start: string }
  | null {
  if (!startLocal && !endLocal) return { end: null, start: null };
  const start = localDateTimeToIso(startLocal, timeZone);
  const end = localDateTimeToIso(endLocal, timeZone);
  if (!start || !end || new Date(start) >= new Date(end)) return null;
  return { end, start };
}

function databaseFailure(code?: string, detail?: string): JobFormState {
  const normalizedDetail = detail?.toLocaleLowerCase() ?? '';
  let message = 'Job could not be saved. Please try again.';
  if (code === '23P01') {
    message = 'This technician already has a job in that time slot.';
  } else if (normalizedDetail.includes('weekly availability')) {
    message = "Selected time is outside the technician's weekly availability.";
  } else if (normalizedDetail.includes('time off')) {
    message = 'Selected time overlaps approved technician time off.';
  } else if (normalizedDetail.includes('required service skills')) {
    message =
      'Technician is missing one or more skills required by this service.';
  } else if (normalizedDetail.includes('service area')) {
    message = normalizedDetail.includes('customer postal code is required')
      ? 'Add a customer ZIP code before assigning this technician.'
      : "This technician's service area does not cover the customer ZIP code.";
  } else if (normalizedDetail.includes('same local day')) {
    message = 'A scheduled job must start and end on the same business day.';
  } else if (code === '23503' || code === '23514' || code === '22023') {
    message =
      'Customer, service, technician, schedule, or status is no longer valid.';
  }

  return {
    message,
    status: 'error',
  };
}

export async function createJobAction(
  _previousState: JobFormState,
  formData: FormData,
): Promise<JobFormState> {
  const parsed = readJob(formData);
  if (!parsed.success) return validationFailure(parsed.error);

  const context = await requireTenantContext(['owner', 'office']);
  const schedule = scheduleValues(
    parsed.data.scheduledStartLocal,
    parsed.data.scheduledEndLocal,
    context.timeZone,
  );
  if (!schedule) {
    return {
      fieldErrors: {
        scheduledEndLocal: ['Enter a valid end time after the start time.'],
      },
      message: 'Please correct the highlighted fields.',
      status: 'error',
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('jobs')
    .insert({
      assigned_membership_id: nullable(parsed.data.assignedMembershipId),
      created_by_user_id: context.userId,
      customer_id: parsed.data.customerId,
      description: nullable(parsed.data.description),
      priority: parsed.data.priority,
      scheduled_end_at: schedule.end,
      scheduled_start_at: schedule.start,
      service_id: nullable(parsed.data.serviceId),
      tenant_id: context.tenantId,
      title: parsed.data.title,
    })
    .select('id')
    .single();

  if (error) return databaseFailure(error.code, error.message);
  revalidatePath('/app');
  revalidatePath('/app/jobs');
  redirect(`/app/jobs/${data.id}`);
}

export async function updateJobAction(
  _previousState: JobFormState,
  formData: FormData,
): Promise<JobFormState> {
  const jobId = jobIdSchema.safeParse(formData.get('jobId'));
  const parsed = readJob(formData);
  if (!jobId.success || !parsed.success) {
    return !parsed.success
      ? validationFailure(parsed.error)
      : { message: 'Invalid job.', status: 'error' };
  }

  const context = await requireTenantContext(['owner', 'office']);
  const schedule = scheduleValues(
    parsed.data.scheduledStartLocal,
    parsed.data.scheduledEndLocal,
    context.timeZone,
  );
  if (!schedule) {
    return {
      fieldErrors: {
        scheduledEndLocal: ['Enter a valid end time after the start time.'],
      },
      message: 'Please correct the highlighted fields.',
      status: 'error',
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('jobs')
    .update({
      assigned_membership_id: nullable(parsed.data.assignedMembershipId),
      customer_id: parsed.data.customerId,
      description: nullable(parsed.data.description),
      priority: parsed.data.priority,
      scheduled_end_at: schedule.end,
      scheduled_start_at: schedule.start,
      service_id: nullable(parsed.data.serviceId),
      title: parsed.data.title,
    })
    .eq('id', jobId.data)
    .eq('tenant_id', context.tenantId)
    .is('archived_at', null)
    .select('id')
    .maybeSingle();

  if (error) return databaseFailure(error.code, error.message);
  if (!data) return { message: 'Job was not found.', status: 'error' };

  revalidatePath('/app');
  revalidatePath('/app/jobs');
  revalidatePath(`/app/jobs/${jobId.data}`);
  redirect(`/app/jobs/${jobId.data}`);
}

export async function updateJobStatusAction(
  _previousState: JobFormState,
  formData: FormData,
): Promise<JobFormState> {
  const jobId = jobIdSchema.safeParse(formData.get('jobId'));
  const requestedStatus = jobStatusSchema.safeParse(formData.get('status'));
  if (!jobId.success || !requestedStatus.success) {
    return { message: 'Invalid status change.', status: 'error' };
  }

  const context = await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase
    .from('jobs')
    .select('status')
    .eq('id', jobId.data)
    .eq('tenant_id', context.tenantId)
    .is('archived_at', null)
    .maybeSingle();
  if (readError || !existing) {
    return { message: 'Job was not found.', status: 'error' };
  }

  const allowed = nextJobStatuses[existing.status];
  if (!allowed.includes(requestedStatus.data)) {
    return { message: 'That status change is not allowed.', status: 'error' };
  }

  const { data, error } = await supabase
    .from('jobs')
    .update({ status: requestedStatus.data })
    .eq('id', jobId.data)
    .eq('tenant_id', context.tenantId)
    .eq('status', existing.status)
    .is('archived_at', null)
    .select('id')
    .maybeSingle();

  if (error) return databaseFailure(error.code, error.message);
  if (!data) {
    return {
      message: 'The job changed elsewhere. Refresh and try again.',
      status: 'error',
    };
  }

  revalidatePath('/app');
  revalidatePath('/app/jobs');
  revalidatePath(`/app/jobs/${jobId.data}`);
  return { message: 'Job status updated.', status: 'success' };
}

export async function archiveJobAction(formData: FormData): Promise<void> {
  const jobId = jobIdSchema.safeParse(formData.get('jobId'));
  if (!jobId.success) return;

  const context = await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const { error } = await supabase
    .from('jobs')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', jobId.data)
    .eq('tenant_id', context.tenantId)
    .is('archived_at', null);

  if (error) throw new Error('Job could not be archived.');
  revalidatePath('/app');
  revalidatePath('/app/jobs');
  redirect('/app/jobs');
}
