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

export type AssignedJobActivity = Pick<
  Database['public']['Tables']['audit_events']['Row'],
  'action' | 'entity_id' | 'id' | 'metadata' | 'occurred_at'
>;

export type JobTimelineItem = {
  readonly detail?: string;
  readonly id: string;
  readonly label: string;
  readonly occurredAt: string;
};

export type AssignedJobsSnapshot = {
  readonly activity: readonly AssignedJobActivity[];
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

  const jobs = jobsResult.data ?? [];
  const jobIds = jobs.map((job) => job.id);
  let activity: AssignedJobActivity[] = [];
  if (jobIds.length > 0) {
    const activityResult = await client
      .from('audit_events')
      .select('id, action, entity_id, metadata, occurred_at')
      .eq('tenant_id', membership.tenant_id)
      .eq('entity_type', 'job')
      .in('entity_id', jobIds)
      .order('occurred_at', { ascending: false })
      .limit(500);
    if (activityResult.error) throw activityResult.error;
    activity = activityResult.data ?? [];
  }

  return {
    activity,
    jobs,
    tenantName: tenantResult.data.display_name,
    timeZone: tenantResult.data.time_zone,
  };
}

const timelineLabels: Readonly<Record<string, string>> = {
  'job.archived': 'Job archived',
  'job.created': 'Job created',
  'job.customer_signature_recorded': 'Customer signature recorded',
  'job.photo_uploaded': 'Job photo uploaded',
  'job.scheduled': 'Schedule or assignment updated',
  'job.status_changed': 'Job status changed',
  'job.updated': 'Job details updated',
  'job.work_note_added': 'Field note added',
};

function metadataRecord(
  metadata: AssignedJobActivity['metadata'],
): Record<string, unknown> | undefined {
  return typeof metadata === 'object' &&
    metadata !== null &&
    !Array.isArray(metadata)
    ? metadata
    : undefined;
}

function statusLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.replaceAll('_', ' ');
}

function timelineDetail(
  activity: AssignedJobActivity,
  timeZone: string,
): string | undefined {
  const metadata = metadataRecord(activity.metadata);
  if (!metadata) return undefined;

  if (activity.action === 'job.status_changed') {
    const from = statusLabel(metadata.from);
    const to = statusLabel(metadata.to);
    return from && to ? `${from} to ${to}` : undefined;
  }

  if (activity.action === 'job.photo_uploaded') {
    const mediaKind = metadata.media_kind;
    return mediaKind === 'before' || mediaKind === 'after'
      ? `${mediaKind[0]?.toUpperCase()}${mediaKind.slice(1)} photo`
      : undefined;
  }

  if (activity.action === 'job.scheduled') {
    const start = metadata.scheduled_start_at;
    const end = metadata.scheduled_end_at;
    if (typeof start !== 'string' || typeof end !== 'string') return undefined;
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return undefined;
    }
    const date = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeZone,
    }).format(startDate);
    const time = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    });
    return `${date}, ${time.format(startDate)}-${time.format(endDate)}`;
  }

  return undefined;
}

export function buildJobTimeline(
  activity: readonly AssignedJobActivity[],
  timeZone: string,
): readonly JobTimelineItem[] {
  return activity
    .map((item) => ({
      detail: timelineDetail(item, timeZone),
      id: item.id,
      label: timelineLabels[item.action] ?? 'Job activity recorded',
      occurredAt: item.occurred_at,
    }))
    .sort(
      (left, right) =>
        new Date(right.occurredAt).getTime() -
        new Date(left.occurredAt).getTime(),
    );
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
