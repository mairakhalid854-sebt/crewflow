import Link from 'next/link';

import type { JobStatus } from './job-status';
import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { createClient } from '../../../lib/supabase/server';
import { jobStatusLabels } from './job-status';

interface JobsPageProps {
  readonly searchParams: Promise<{ q?: string; status?: string }>;
}

const statuses = Object.keys(jobStatusLabels) as JobStatus[];

function formatSchedule(value: string | null, timeZone: string): string {
  if (!value) return 'Not scheduled';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

export const dynamic = 'force-dynamic';

export default async function JobsPage({ searchParams }: JobsPageProps) {
  const context = await requireTenantContext();
  const params = await searchParams;
  const search =
    typeof params.q === 'string' ? params.q.trim().slice(0, 80) : '';
  const status = statuses.includes(params.status as JobStatus)
    ? (params.status as JobStatus)
    : '';
  const supabase = await createClient();
  let jobsQuery = supabase
    .from('jobs')
    .select('*')
    .eq('tenant_id', context.tenantId)
    .is('archived_at', null)
    .order('updated_at', { ascending: false })
    .limit(300);
  if (status) jobsQuery = jobsQuery.eq('status', status);

  const [jobsResult, customersResult, servicesResult, profilesResult] =
    await Promise.all([
      jobsQuery,
      supabase
        .from('customers')
        .select('id, first_name, last_name')
        .eq('tenant_id', context.tenantId),
      supabase
        .from('services')
        .select('id, name')
        .eq('tenant_id', context.tenantId),
      supabase
        .from('staff_profiles')
        .select('membership_id, full_name')
        .eq('tenant_id', context.tenantId),
    ]);

  if (
    jobsResult.error ||
    customersResult.error ||
    servicesResult.error ||
    profilesResult.error
  ) {
    throw new Error('Jobs could not be loaded.');
  }

  const customers = new Map(
    (customersResult.data ?? []).map((customer) => [
      customer.id,
      `${customer.first_name} ${customer.last_name}`,
    ]),
  );
  const services = new Map(
    (servicesResult.data ?? []).map((service) => [service.id, service.name]),
  );
  const technicians = new Map(
    (profilesResult.data ?? []).map((profile) => [
      profile.membership_id,
      profile.full_name,
    ]),
  );
  const needle = search.toLocaleLowerCase();
  const jobs = needle
    ? (jobsResult.data ?? []).filter((job) =>
        [
          job.title,
          job.description,
          customers.get(job.customer_id),
          job.service_id ? services.get(job.service_id) : null,
          job.assigned_membership_id
            ? technicians.get(job.assigned_membership_id)
            : null,
        ].some((value) => value?.toLocaleLowerCase().includes(needle)),
      )
    : (jobsResult.data ?? []);

  return (
    <div className="workspace-page">
      <header className="workspace-heading">
        <div>
          <p className="workspace-kicker">Operations</p>
          <h1>Jobs</h1>
          <p>Customer work, assignments, schedules, and workflow status.</p>
        </div>
        {context.role !== 'technician' ? (
          <Link className="primary-button" href="/app/jobs/new">
            Create job
          </Link>
        ) : null}
      </header>

      <form className="resource-search job-filters" role="search">
        <label htmlFor="job-search">Search jobs</label>
        <div>
          <input
            defaultValue={search}
            id="job-search"
            name="q"
            placeholder="Title, customer, service, or technician"
            type="search"
          />
          <select defaultValue={status} name="status">
            <option value="">All statuses</option>
            {statuses.map((option) => (
              <option key={option} value={option}>
                {jobStatusLabels[option]}
              </option>
            ))}
          </select>
          <button className="secondary-button" type="submit">
            Filter
          </button>
        </div>
      </form>

      {jobs.length === 0 ? (
        <section className="empty-state">
          <h2>{search || status ? 'No matching jobs' : 'No jobs yet'}</h2>
          <p>
            {search || status
              ? 'Try a different search or status filter.'
              : context.role === 'technician'
                ? 'Assigned jobs will appear here.'
                : 'Create the first job from an active customer.'}
          </p>
        </section>
      ) : (
        <div className="resource-table-wrap">
          <table className="resource-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Technician</th>
                <th>Schedule</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <strong>{job.title}</strong>
                    <small className="table-subtext">
                      {job.service_id
                        ? (services.get(job.service_id) ?? 'Archived service')
                        : 'Custom work'}
                    </small>
                  </td>
                  <td>{customers.get(job.customer_id) ?? 'Customer'}</td>
                  <td>
                    <span className={`status-badge status-job-${job.status}`}>
                      {jobStatusLabels[job.status]}
                    </span>
                  </td>
                  <td>
                    {job.assigned_membership_id
                      ? (technicians.get(job.assigned_membership_id) ??
                        'Technician')
                      : 'Unassigned'}
                  </td>
                  <td>
                    {formatSchedule(job.scheduled_start_at, context.timeZone)}
                  </td>
                  <td>
                    <Link href={`/app/jobs/${job.id}`}>View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
