import Link from 'next/link';

import { requireTenantContext } from '../../../../lib/auth/tenant-context';
import { createClient } from '../../../../lib/supabase/server';

import styles from '../ai.module.css';
import { DispatcherRequestForm } from './dispatcher-request-form';

export const dynamic = 'force-dynamic';

function formatSchedule(
  startsAt: string | null,
  endsAt: string | null,
  timeZone: string,
): string {
  if (!startsAt || !endsAt) return 'Schedule required';
  const formatter = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  });
  return `${formatter.format(new Date(startsAt))} – ${formatter.format(new Date(endsAt))}`;
}

export default async function DispatcherSuggestionsPage() {
  const context = await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const [
    jobsResult,
    customersResult,
    servicesResult,
    profilesResult,
    settingsResult,
  ] = await Promise.all([
    supabase
      .from('jobs')
      .select(
        'id,title,status,customer_id,service_id,assigned_membership_id,scheduled_start_at,scheduled_end_at',
      )
      .eq('tenant_id', context.tenantId)
      .is('archived_at', null)
      .in('status', ['accepted', 'scheduled', 'in_progress'])
      .order('scheduled_start_at', { ascending: true })
      .limit(100),
    supabase
      .from('customers')
      .select('id,first_name,last_name,postal_code')
      .eq('tenant_id', context.tenantId),
    supabase
      .from('services')
      .select('id,name')
      .eq('tenant_id', context.tenantId),
    supabase
      .from('staff_profiles')
      .select('membership_id,full_name')
      .eq('tenant_id', context.tenantId),
    supabase
      .from('tenant_settings')
      .select('ai_operations_enabled,ai_monthly_budget_cents')
      .eq('tenant_id', context.tenantId)
      .single(),
  ]);

  if (
    jobsResult.error ||
    customersResult.error ||
    servicesResult.error ||
    profilesResult.error ||
    settingsResult.error ||
    !settingsResult.data
  ) {
    throw new Error('Dispatcher suggestions could not be loaded.');
  }

  const customers = new Map(
    (customersResult.data ?? []).map((customer) => [customer.id, customer]),
  );
  const services = new Map(
    (servicesResult.data ?? []).map((service) => [service.id, service.name]),
  );
  const profiles = new Map(
    (profilesResult.data ?? []).map((profile) => [
      profile.membership_id,
      profile.full_name,
    ]),
  );
  const enabled =
    settingsResult.data.ai_operations_enabled &&
    settingsResult.data.ai_monthly_budget_cents > 0;

  return (
    <div className="workspace-page">
      <header className="workspace-heading">
        <div>
          <p className="workspace-kicker">Deterministic assistant</p>
          <h1>Dispatcher suggestions</h1>
          <p>
            Evaluate skills, service ZIP, weekly availability, time off,
            conflicts, and workload before a person approves any assignment.
          </p>
        </div>
        <Link className="secondary-button" href="/app/ai">
          Review AI operations
        </Link>
      </header>

      <p className={styles.dispatcherNotice}>
        Dispatcher never changes a job from this screen. Every new assignment
        suggestion goes to the human approval queue.{' '}
        {!enabled ? (
          <>
            <Link href="/app/settings">Enable AI operations</Link> and set a
            positive monthly budget to request suggestions.
          </>
        ) : (
          'AI operations are enabled for this workspace.'
        )}
      </p>

      {jobsResult.data?.length ? (
        <div className={styles.dispatcherGrid}>
          {jobsResult.data.map((job) => {
            const customer = customers.get(job.customer_id);
            const hasSchedule = Boolean(
              job.scheduled_start_at && job.scheduled_end_at,
            );
            const hasPostalCode = Boolean(customer?.postal_code);
            return (
              <article className={styles.dispatcherJob} key={job.id}>
                <div>
                  <span className={styles.status} data-status={job.status}>
                    {job.status.replaceAll('_', ' ')}
                  </span>
                  <h2>{job.title}</h2>
                  <p>
                    {customer
                      ? `${customer.first_name} ${customer.last_name}`
                      : 'Customer'}
                  </p>
                </div>
                <dl className={styles.dispatcherFacts}>
                  <div>
                    <dt>Service</dt>
                    <dd>
                      {job.service_id
                        ? (services.get(job.service_id) ?? 'Unknown service')
                        : 'No catalog service'}
                    </dd>
                  </div>
                  <div>
                    <dt>Service ZIP</dt>
                    <dd>{customer?.postal_code ?? 'Required'}</dd>
                  </div>
                  <div>
                    <dt>Schedule</dt>
                    <dd>
                      {formatSchedule(
                        job.scheduled_start_at,
                        job.scheduled_end_at,
                        context.timeZone,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Current technician</dt>
                    <dd>
                      {job.assigned_membership_id
                        ? (profiles.get(job.assigned_membership_id) ??
                          'Assigned technician')
                        : 'Unassigned'}
                    </dd>
                  </div>
                </dl>
                <DispatcherRequestForm
                  disabled={!enabled || !hasSchedule || !hasPostalCode}
                  jobId={job.id}
                />
              </article>
            );
          })}
        </div>
      ) : (
        <section className="empty-state">
          <h2>No jobs are ready for evaluation</h2>
          <p>
            Accepted, scheduled, or in-progress jobs will appear here. A
            complete schedule and customer ZIP are required for a suggestion.
          </p>
        </section>
      )}
    </div>
  );
}
