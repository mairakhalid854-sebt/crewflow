import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { requireTenantContext } from '../../../../lib/auth/tenant-context';
import { formatInvoiceNumber } from '../../../../lib/invoices/public-invoice';
import { formatUsd } from '../../../../lib/quotes/public-quote';
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
  const [customerResult, jobsResult, invoicesResult] = await Promise.all([
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
    supabase
      .from('invoices')
      .select(
        'id, invoice_number, job_id, status, total_cents, paid_cents, due_at',
      )
      .eq('customer_id', id)
      .eq('tenant_id', context.tenantId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);
  const { data: customer, error } = customerResult;

  if (error) throw new Error('Customer could not be loaded.');
  if (jobsResult.error) throw new Error('Customer jobs could not be loaded.');
  if (invoicesResult.error) {
    throw new Error('Customer invoices could not be loaded.');
  }
  if (!customer) notFound();
  const lifetimePaid = (invoicesResult.data ?? []).reduce(
    (total, invoice) => total + invoice.paid_cents,
    0,
  );

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
      <section className="team-panel customer-jobs-panel">
        <div className="team-panel-heading">
          <div>
            <h2>Invoices</h2>
            <p>
              {invoicesResult.data?.length ?? 0} records ·{' '}
              {formatUsd(lifetimePaid)} lifetime recorded paid
            </p>
          </div>
          <Link className="secondary-button" href="/app/invoices">
            All invoices
          </Link>
        </div>
        {invoicesResult.data?.length ? (
          <div className="resource-table-wrap">
            <table className="resource-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Outstanding</th>
                  <th>
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoicesResult.data.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <strong>
                        {formatInvoiceNumber(invoice.invoice_number)}
                      </strong>
                    </td>
                    <td>
                      <span
                        className={`status-badge status-invoice-${invoice.status}`}
                      >
                        {invoice.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td>{formatUsd(invoice.total_cents)}</td>
                    <td>
                      {formatUsd(invoice.total_cents - invoice.paid_cents)}
                    </td>
                    <td>
                      <Link href={`/app/jobs/${invoice.job_id}`}>View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="form-help">No invoices for this customer yet.</p>
        )}
      </section>
    </div>
  );
}
