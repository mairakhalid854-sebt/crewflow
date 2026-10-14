import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { requireTenantContext } from '../../../../lib/auth/tenant-context';
import { createClient } from '../../../../lib/supabase/server';
import { archiveCustomerAction } from '../actions';
import { ArchiveCustomerButton } from '../archive-customer-button';
import { CustomerForm } from '../customer-form';
import { jobStatusLabels } from '../../jobs/job-status';

interface CustomerDetailPageProps {
  readonly params: Promise<{ id: string }>;
}

export default async function CustomerDetailPage({
  params,
}: CustomerDetailPageProps) {
  const context = await requireTenantContext(['owner', 'office']);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const [customerResult, jobsResult] = await Promise.all([
    supabase
      .from('customers')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', context.tenantId)
      .is('archived_at', null)
      .maybeSingle(),
    supabase
      .from('jobs')
      .select('id, title, status, scheduled_start_at')
      .eq('customer_id', id)
      .eq('tenant_id', context.tenantId)
      .is('archived_at', null)
      .order('updated_at', { ascending: false })
      .limit(50),
  ]);
  const { data: customer, error } = customerResult;

  if (error) throw new Error('Customer could not be loaded.');
  if (jobsResult.error) throw new Error('Customer jobs could not be loaded.');
  if (!customer) notFound();

  return (
    <div className="workspace-page resource-editor-page">
      <Link className="back-link" href="/app/customers">
        ← Customers
      </Link>
      <header className="resource-detail-heading">
        <div>
          <p className="workspace-kicker">Customer record</p>
          <h1>
            {customer.first_name} {customer.last_name}
          </h1>
          <p>Update contact details, address, notes, and consent.</p>
        </div>
        <ArchiveCustomerButton
          action={archiveCustomerAction}
          customerId={customer.id}
        />
      </header>
      <CustomerForm customer={customer} />
      <section className="team-panel customer-jobs-panel">
        <div className="team-panel-heading">
          <div>
            <h2>Jobs</h2>
            <p>{jobsResult.data?.length ?? 0} current work records.</p>
          </div>
          <Link className="secondary-button" href={`/app/jobs/new`}>
            Create job
          </Link>
        </div>
        {jobsResult.data?.length ? (
          <div className="resource-table-wrap">
            <table className="resource-table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Status</th>
                  <th>Schedule</th>
                  <th>
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {jobsResult.data.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <strong>{job.title}</strong>
                    </td>
                    <td>
                      <span className={`status-badge status-job-${job.status}`}>
                        {jobStatusLabels[job.status]}
                      </span>
                    </td>
                    <td>
                      {job.scheduled_start_at
                        ? new Intl.DateTimeFormat('en-US', {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                            timeZone: context.timeZone,
                          }).format(new Date(job.scheduled_start_at))
                        : 'Not scheduled'}
                    </td>
                    <td>
                      <Link href={`/app/jobs/${job.id}`}>View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h3>No jobs for this customer</h3>
            <p>Create a job to begin their service history.</p>
          </div>
        )}
      </section>
    </div>
  );
}
