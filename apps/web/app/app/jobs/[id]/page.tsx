import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireTenantContext } from '../../../../lib/auth/tenant-context';
import { isoToLocalDateTime } from '../../../../lib/date-time';
import { createClient } from '../../../../lib/supabase/server';
import { archiveJobAction } from '../actions';
import { ArchiveJobButton } from '../archive-job-button';
import { JobForm } from '../job-form';
import { jobStatusLabels } from '../job-status';
import { JobStatusForm } from '../job-status-form';
import { QuotePanel } from '../quote-panel';

export const dynamic = 'force-dynamic';

function formatActivity(action: string): string {
  const labels: Readonly<Record<string, string>> = {
    'job.archived': 'Job archived',
    'job.created': 'Job created',
    'job.scheduled': 'Assignment or schedule updated',
    'job.status_changed': 'Job status changed',
    'job.updated': 'Job details updated',
  };
  return labels[action] ?? action;
}

export default async function JobDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const context = await requireTenantContext();
  const supabase = await createClient();
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', context.tenantId)
    .is('archived_at', null)
    .maybeSingle();
  if (jobError) throw new Error('Job could not be loaded.');
  if (!job) notFound();

  const [
    customersResult,
    servicesResult,
    membersResult,
    profilesResult,
    activityResult,
    quoteResult,
  ] = await Promise.all([
    supabase
      .from('customers')
      .select('id, first_name, last_name')
      .eq('tenant_id', context.tenantId)
      .order('last_name'),
    supabase
      .from('services')
      .select('id, name')
      .eq('tenant_id', context.tenantId)
      .order('name'),
    supabase
      .from('memberships')
      .select('id')
      .eq('tenant_id', context.tenantId)
      .eq('role', 'technician')
      .eq('status', 'active'),
    supabase
      .from('staff_profiles')
      .select('membership_id, full_name')
      .eq('tenant_id', context.tenantId),
    supabase
      .from('audit_events')
      .select('id, action, metadata, occurred_at')
      .eq('tenant_id', context.tenantId)
      .eq('entity_type', 'job')
      .eq('entity_id', id)
      .order('occurred_at', { ascending: false })
      .limit(50),
    supabase
      .from('quotes')
      .select('*')
      .eq('tenant_id', context.tenantId)
      .eq('job_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (
    customersResult.error ||
    servicesResult.error ||
    membersResult.error ||
    profilesResult.error ||
    activityResult.error ||
    quoteResult.error
  ) {
    throw new Error('Job details could not be loaded.');
  }

  const activeTechnicians = new Set(
    (membersResult.data ?? []).map((membership) => membership.id),
  );
  const customers = (customersResult.data ?? []).map((customer) => ({
    id: customer.id,
    label: `${customer.first_name} ${customer.last_name}`,
  }));
  const services = (servicesResult.data ?? []).map((service) => ({
    id: service.id,
    label: service.name,
  }));
  const technicians = (profilesResult.data ?? [])
    .filter(
      (profile) =>
        activeTechnicians.has(profile.membership_id) ||
        profile.membership_id === job.assigned_membership_id,
    )
    .map((profile) => ({
      id: profile.membership_id,
      label: profile.full_name,
    }));
  const customerName =
    customers.find((customer) => customer.id === job.customer_id)?.label ??
    'Customer';
  const technicianName = job.assigned_membership_id
    ? (technicians.find(
        (technician) => technician.id === job.assigned_membership_id,
      )?.label ?? 'Technician')
    : 'Unassigned';
  const latestQuote = quoteResult.data ?? undefined;
  const { data: quoteLines, error: quoteLinesError } = latestQuote
    ? await supabase
        .from('quote_line_items')
        .select('*')
        .eq('tenant_id', context.tenantId)
        .eq('quote_id', latestQuote.id)
        .order('position')
    : { data: [], error: null };
  if (quoteLinesError) throw new Error('Quote details could not be loaded.');

  return (
    <div className="workspace-page job-detail-page">
      <Link className="back-link" href="/app/jobs">
        ← Back to jobs
      </Link>
      <header className="job-detail-header">
        <div>
          <p className="workspace-kicker">{customerName}</p>
          <h1>{job.title}</h1>
          <div className="job-summary-badges">
            <span className={`status-badge status-job-${job.status}`}>
              {jobStatusLabels[job.status]}
            </span>
            <span className="status-badge">{job.priority} priority</span>
            <span className="status-badge">{technicianName}</span>
          </div>
        </div>
      </header>

      {context.role === 'technician' ? (
        <section className="job-readonly-card">
          <h2>Assigned work</h2>
          <dl>
            <div>
              <dt>Customer</dt>
              <dd>{customerName}</dd>
            </div>
            <div>
              <dt>Technician</dt>
              <dd>{technicianName}</dd>
            </div>
            <div>
              <dt>Schedule</dt>
              <dd>
                {job.scheduled_start_at
                  ? new Intl.DateTimeFormat('en-US', {
                      dateStyle: 'full',
                      timeStyle: 'short',
                      timeZone: context.timeZone,
                    }).format(new Date(job.scheduled_start_at))
                  : 'Not scheduled'}
              </dd>
            </div>
            <div>
              <dt>Description</dt>
              <dd>{job.description ?? 'No description'}</dd>
            </div>
          </dl>
        </section>
      ) : (
        <div className="job-detail-grid">
          <div>
            <JobForm
              customers={customers}
              job={job}
              scheduledEndLocal={isoToLocalDateTime(
                job.scheduled_end_at,
                context.timeZone,
              )}
              scheduledStartLocal={isoToLocalDateTime(
                job.scheduled_start_at,
                context.timeZone,
              )}
              services={services}
              technicians={technicians}
              timeZone={context.timeZone}
            />
          </div>
          <aside className="job-workflow-panel">
            <h2>Workflow</h2>
            <p>
              Status changes follow the guarded job lifecycle and are recorded
              in the activity timeline.
            </p>
            <JobStatusForm jobId={job.id} status={job.status} />
            <ArchiveJobButton action={archiveJobAction} jobId={job.id} />
          </aside>
        </div>
      )}

      {context.role !== 'technician' ? (
        <QuotePanel
          jobId={job.id}
          lines={quoteLines ?? []}
          quote={latestQuote}
        />
      ) : null}

      <section className="team-panel job-activity-panel">
        <div className="team-panel-heading">
          <div>
            <h2>Activity</h2>
            <p>Immutable job changes, newest first.</p>
          </div>
        </div>
        {(activityResult.data ?? []).length ? (
          <ol className="activity-list">
            {(activityResult.data ?? []).map((event) => (
              <li key={event.id}>
                <strong>{formatActivity(event.action)}</strong>
                <time dateTime={event.occurred_at}>
                  {new Intl.DateTimeFormat('en-US', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: context.timeZone,
                  }).format(new Date(event.occurred_at))}
                </time>
              </li>
            ))}
          </ol>
        ) : (
          <p className="form-help">No activity recorded yet.</p>
        )}
      </section>
    </div>
  );
}
