import type { Database } from '@crewflow/database';
import type { QueryData, SupabaseClient } from '@supabase/supabase-js';

import type { MobileMembership } from '../auth/membership-access';

const assignedJobSelect = `
  id,
  title,
  description,
  priority,
  status,
  scheduled_start_at,
  scheduled_end_at,
  updated_at,
  customers!jobs_customer_tenant_fk (
    first_name,
    last_name,
    phone,
    street_address,
    address_line_2,
    city,
    state_code,
    postal_code
  ),
  services!jobs_service_tenant_fk (name),
  job_work_notes (
    id,
    body,
    created_at
  ),
  job_media (
    id,
    media_kind,
    uploaded_at
  ),
  job_signatures (
    id,
    signer_name,
    signed_at
  )
` as const;

function assignedJobsQuery(
  client: SupabaseClient<Database>,
  membership: Pick<MobileMembership, 'id' | 'tenant_id'>,
) {
  return client
    .from('jobs')
    .select(assignedJobSelect)
    .eq('tenant_id', membership.tenant_id)
    .eq('assigned_membership_id', membership.id)
    .is('archived_at', null)
    .order('scheduled_start_at', { ascending: true, nullsFirst: false })
    .limit(100);
}

export type AssignedJob = QueryData<
  ReturnType<typeof assignedJobsQuery>
>[number];

export type AssignedJobsSnapshot = {
  readonly jobs: readonly AssignedJob[];
  readonly tenantName: string;
  readonly timeZone: string;
};

export type TechnicianProgressStatus = Extract<
  AssignedJob['status'],
  'in_progress' | 'completed'
>;

export type TechnicianProgressAction = {
  readonly label: string;
  readonly noteRequired: boolean;
  readonly status: TechnicianProgressStatus;
};

export async function loadAssignedJobs(
  client: SupabaseClient<Database>,
  membership: Pick<MobileMembership, 'id' | 'tenant_id'>,
): Promise<AssignedJobsSnapshot> {
  const [jobsResult, tenantResult] = await Promise.all([
    assignedJobsQuery(client, membership),
    client
      .from('tenants')
      .select('display_name, time_zone')
      .eq('id', membership.tenant_id)
      .single(),
  ]);

  if (jobsResult.error) throw jobsResult.error;
  if (tenantResult.error) throw tenantResult.error;

  return {
    jobs: jobsResult.data ?? [],
    tenantName: tenantResult.data.display_name,
    timeZone: tenantResult.data.time_zone,
  };
}

export async function advanceAssignedJob(
  client: SupabaseClient<Database>,
  jobId: string,
  status: TechnicianProgressStatus,
  note: string,
): Promise<void> {
  const { error } = await client.rpc('advance_assigned_job', {
    target_job_id: jobId,
    target_status: status,
    work_note: note.trim(),
  });

  if (error) throw error;
}

export function technicianProgressAction(
  status: AssignedJob['status'],
): TechnicianProgressAction | undefined {
  if (status === 'scheduled') {
    return {
      label: 'Start job',
      noteRequired: false,
      status: 'in_progress',
    };
  }

  if (status === 'in_progress') {
    return {
      label: 'Complete job',
      noteRequired: true,
      status: 'completed',
    };
  }

  return undefined;
}

export function validateProgressNote(
  note: string,
  action: TechnicianProgressAction,
): string | undefined {
  const length = note.trim().length;
  if (length > 2000) return 'Work note cannot exceed 2,000 characters.';
  if (action.noteRequired && length < 3) {
    return 'Add a short completion note before completing this job.';
  }
  if (length > 0 && length < 3) {
    return 'Work note must be at least 3 characters or left blank.';
  }
  return undefined;
}

const historicalStatuses = new Set<AssignedJob['status']>([
  'cancelled',
  'closed',
  'completed',
]);

function scheduleTime(job: AssignedJob): number {
  if (!job.scheduled_start_at) return Number.POSITIVE_INFINITY;
  return new Date(job.scheduled_start_at).getTime();
}

export function partitionAssignedJobs(jobs: readonly AssignedJob[]): {
  readonly history: AssignedJob[];
  readonly upcoming: AssignedJob[];
} {
  const upcoming = jobs
    .filter((job) => !historicalStatuses.has(job.status))
    .sort((left, right) => scheduleTime(left) - scheduleTime(right));
  const history = jobs
    .filter((job) => historicalStatuses.has(job.status))
    .sort(
      (left, right) =>
        new Date(right.updated_at).getTime() -
        new Date(left.updated_at).getTime(),
    );

  return { history, upcoming };
}

export function formatJobSchedule(
  job: Pick<AssignedJob, 'scheduled_end_at' | 'scheduled_start_at'>,
  timeZone: string,
): string {
  if (!job.scheduled_start_at || !job.scheduled_end_at) return 'Unscheduled';

  const start = new Date(job.scheduled_start_at);
  const end = new Date(job.scheduled_end_at);
  const date = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone,
    weekday: 'short',
  }).format(start);
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  });

  return `${date}, ${time.format(start)}-${time.format(end)}`;
}

export function formatCustomerAddress(
  customer: AssignedJob['customers'] | null,
): string | undefined {
  if (!customer) return undefined;

  const locality = [customer.city, customer.state_code, customer.postal_code]
    .filter(Boolean)
    .join(' ');
  const address = [customer.street_address, customer.address_line_2, locality]
    .filter(Boolean)
    .join(', ');

  return address || undefined;
}
