import Link from 'next/link';

import { requireTenantContext } from '../../lib/auth/tenant-context';
import { formatUsd } from '../../lib/quotes/public-quote';
import { createClient } from '../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function AuthenticatedDashboardPage() {
  const context = await requireTenantContext();
  const supabase = await createClient();
  const [jobsResult, invoiceResult, paymentResult] = await Promise.all([
    supabase
      .from('jobs')
      .select('id, status, assigned_membership_id, scheduled_start_at')
      .eq('tenant_id', context.tenantId)
      .is('archived_at', null)
      .limit(1000),
    supabase
      .from('invoices')
      .select('id, status')
      .eq('tenant_id', context.tenantId)
      .limit(1000),
    supabase
      .from('payment_records')
      .select('amount_cents, received_at')
      .eq('tenant_id', context.tenantId)
      .limit(1000),
  ]);
  if (jobsResult.error || invoiceResult.error || paymentResult.error) {
    throw new Error('Dashboard metrics could not be loaded.');
  }

  const localDate = (value: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      month: '2-digit',
      timeZone: context.timeZone,
      year: 'numeric',
    }).format(value);
  const today = localDate(new Date());
  const jobRows = jobsResult.data ?? [];
  const todayCount = jobRows.filter(
    (job) =>
      job.scheduled_start_at &&
      localDate(new Date(job.scheduled_start_at)) === today,
  ).length;
  const unassignedCount = jobRows.filter(
    (job) =>
      !job.assigned_membership_id &&
      !['closed', 'cancelled'].includes(job.status),
  ).length;
  const activeCount = jobRows.filter((job) =>
    ['scheduled', 'in_progress'].includes(job.status),
  ).length;
  const openCount = jobRows.filter(
    (job) => !['closed', 'cancelled'].includes(job.status),
  ).length;
  const unpaidCount = (invoiceResult.data ?? []).filter((invoice) =>
    ['sent', 'partially_paid'].includes(invoice.status),
  ).length;
  const currentMonth = today.slice(0, 7);
  const monthlyReceived = (paymentResult.data ?? [])
    .filter(
      (payment) =>
        localDate(new Date(payment.received_at)).slice(0, 7) === currentMonth,
    )
    .reduce((total, payment) => total + payment.amount_cents, 0);

  return (
    <div className="workspace-page">
      <div className="workspace-heading">
        <div>
          <p className="workspace-kicker">Overview</p>
          <h1>Welcome back, {context.userName.split(' ')[0] ?? 'there'}</h1>
          <p>Track current work and keep company setup ready for dispatch.</p>
        </div>
      </div>

      <section className="dashboard-metrics" aria-label="Job summary">
        <Link className="metric-card" href="/app/jobs">
          <span>Today</span>
          <strong>{todayCount}</strong>
          <small>scheduled jobs</small>
        </Link>
        <Link className="metric-card" href="/app/jobs">
          <span>Unassigned</span>
          <strong>{unassignedCount}</strong>
          <small>jobs need a technician</small>
        </Link>
        <Link className="metric-card" href="/app/jobs?status=in_progress">
          <span>Active</span>
          <strong>{activeCount}</strong>
          <small>scheduled or in progress</small>
        </Link>
        {context.role !== 'technician' ? (
          <Link className="metric-card" href="/app/invoices">
            <span>Unpaid</span>
            <strong>{unpaidCount}</strong>
            <small>sent invoices outstanding</small>
          </Link>
        ) : null}
        {context.role !== 'technician' ? (
          <Link className="metric-card" href="/app/invoices">
            <span>Received this month</span>
            <strong>{formatUsd(monthlyReceived)}</strong>
            <small>recorded ledger revenue</small>
          </Link>
        ) : null}
        <Link className="metric-card" href="/app/jobs">
          <span>Open</span>
          <strong>{openCount}</strong>
          <small>jobs in the workflow</small>
        </Link>
      </section>

      <section className="setup-grid" aria-label="Workspace shortcuts">
        <Link className="setup-card" href="/app/jobs">
          <span>01</span>
          <h2>Jobs</h2>
          <p>Create work orders, assign technicians, and manage status.</p>
        </Link>
        {context.role !== 'technician' ? (
          <Link className="setup-card" href="/app/customers">
            <span>02</span>
            <h2>Customers</h2>
            <p>
              Add customer contact details, addresses, notes, and preferences.
            </p>
          </Link>
        ) : null}
        <Link className="setup-card" href="/app/services">
          <span>03</span>
          <h2>Services</h2>
          <p>Configure prices, duration, and tax behavior for offered work.</p>
        </Link>
        {context.role !== 'technician' ? (
          <Link className="setup-card" href="/app/team">
            <span>04</span>
            <h2>Team</h2>
            <p>Invite people, assign roles, and configure staff coverage.</p>
          </Link>
        ) : null}
        {context.role === 'owner' ? (
          <Link className="setup-card" href="/app/settings">
            <span>05</span>
            <h2>Company settings</h2>
            <p>Review business hours, tax defaults, and workspace policy.</p>
          </Link>
        ) : null}
      </section>
    </div>
  );
}
