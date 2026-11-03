import Link from 'next/link';

import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { formatInvoiceNumber } from '../../../lib/invoices/public-invoice';
import { formatUsd } from '../../../lib/quotes/public-quote';
import { createClient } from '../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function InvoicesPage() {
  const context = await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const [invoiceResult, jobResult, customerResult] = await Promise.all([
    supabase
      .from('invoices')
      .select('*')
      .eq('tenant_id', context.tenantId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.from('jobs').select('id, title').eq('tenant_id', context.tenantId),
    supabase
      .from('customers')
      .select('id, first_name, last_name')
      .eq('tenant_id', context.tenantId),
  ]);
  if (invoiceResult.error || jobResult.error || customerResult.error) {
    throw new Error('Invoices could not be loaded.');
  }

  const jobs = new Map(
    (jobResult.data ?? []).map((job) => [job.id, job.title]),
  );
  const customers = new Map(
    (customerResult.data ?? []).map((customer) => [
      customer.id,
      `${customer.first_name} ${customer.last_name}`,
    ]),
  );
  const invoices = invoiceResult.data ?? [];

  return (
    <div className="workspace-page">
      <div className="workspace-heading">
        <div>
          <p className="workspace-kicker">Billing records</p>
          <h1>Invoices</h1>
          <p>
            Track immutable invoice snapshots and explicitly recorded payments.
          </p>
        </div>
      </div>

      {invoices.length ? (
        <div className="resource-table-wrap">
          <table className="resource-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer / job</th>
                <th>Status</th>
                <th>Total</th>
                <th>Outstanding</th>
                <th>Due</th>
                <th>
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td>
                    <strong>
                      {formatInvoiceNumber(invoice.invoice_number)}
                    </strong>
                  </td>
                  <td>
                    <strong>
                      {customers.get(invoice.customer_id) ?? 'Customer'}
                    </strong>
                    <br />
                    <span>{jobs.get(invoice.job_id) ?? 'Job'}</span>
                  </td>
                  <td>
                    <span
                      className={`status-badge status-invoice-${invoice.status}`}
                    >
                      {invoice.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td>{formatUsd(invoice.total_cents)}</td>
                  <td>{formatUsd(invoice.total_cents - invoice.paid_cents)}</td>
                  <td>
                    {new Intl.DateTimeFormat('en-US', {
                      dateStyle: 'medium',
                      timeZone: context.timeZone,
                    }).format(new Date(invoice.due_at))}
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
        <div className="empty-state">
          <h2>No invoices yet</h2>
          <p>Complete a job, then create its invoice from the job page.</p>
        </div>
      )}
    </div>
  );
}
