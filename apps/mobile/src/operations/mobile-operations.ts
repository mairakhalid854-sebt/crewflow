import type { Database } from '@crewflow/database';
import type { QueryData, SupabaseClient } from '@supabase/supabase-js';

import type { MobileMembership } from '../auth/membership-access';

const operationsJobSelect = `
  id,
  title,
  description,
  priority,
  status,
  assigned_membership_id,
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
  services!jobs_service_tenant_fk (name)
` as const;

function operationsJobsQuery(
  client: SupabaseClient<Database>,
  tenantId: string,
) {
  return client
    .from('jobs')
    .select(operationsJobSelect)
    .eq('tenant_id', tenantId)
    .is('archived_at', null)
    .order('scheduled_start_at', { ascending: true, nullsFirst: false })
    .limit(500);
}

function operationsInvoicesQuery(
  client: SupabaseClient<Database>,
  tenantId: string,
) {
  return client
    .from('invoices')
    .select(
      'id, job_id, invoice_number, status, total_cents, paid_cents, due_at, updated_at',
    )
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })
    .limit(500);
}

function draftQuotesQuery(client: SupabaseClient<Database>, tenantId: string) {
  return client
    .from('quotes')
    .select('id, job_id, total_cents, expires_at, updated_at')
    .eq('tenant_id', tenantId)
    .eq('status', 'draft')
    .order('updated_at', { ascending: false })
    .limit(100);
}

function draftReportsQuery(client: SupabaseClient<Database>, tenantId: string) {
  return client
    .from('work_reports')
    .select(
      'id, job_id, summary, work_performed, parts_used, recommendations, updated_at',
    )
    .eq('tenant_id', tenantId)
    .eq('status', 'draft')
    .order('updated_at', { ascending: false })
    .limit(100);
}

function ownerPaymentsQuery(
  client: SupabaseClient<Database>,
  tenantId: string,
) {
  return client
    .from('payment_records')
    .select('amount_cents, received_at')
    .eq('tenant_id', tenantId)
    .order('received_at', { ascending: false })
    .limit(1000);
}

export type OperationsJob = QueryData<
  ReturnType<typeof operationsJobsQuery>
>[number];
export type OperationsInvoice = QueryData<
  ReturnType<typeof operationsInvoicesQuery>
>[number];
type OperationsQuote = QueryData<ReturnType<typeof draftQuotesQuery>>[number];
type OperationsReport = QueryData<ReturnType<typeof draftReportsQuery>>[number];
type OperationsPayment = QueryData<
  ReturnType<typeof ownerPaymentsQuery>
>[number];

type OperationsApprovalBase = {
  readonly id: string;
  readonly jobId: string;
  readonly jobTitle: string;
  readonly updatedAt: string;
};

export type OperationsApproval =
  | (OperationsApprovalBase & {
      readonly expiresAt: string;
      readonly kind: 'quote';
      readonly totalCents: number;
    })
  | (OperationsApprovalBase & {
      readonly dueAt: string;
      readonly invoiceNumber: number;
      readonly kind: 'invoice';
      readonly totalCents: number;
    })
  | (OperationsApprovalBase & {
      readonly kind: 'report';
      readonly partsUsed: string | null;
      readonly recommendations: string | null;
      readonly summary: string;
      readonly workPerformed: string;
    });

export type OperationsMetrics = {
  readonly activeCount: number;
  readonly monthlyReceivedCents?: number;
  readonly openCount: number;
  readonly pendingApprovalCount: number;
  readonly todayCount: number;
  readonly unassignedCount: number;
  readonly unpaidCount: number;
};

export type MobileOperationsSnapshot = {
  readonly jobs: readonly OperationsJob[];
  readonly metrics: OperationsMetrics;
  readonly pendingApprovals: readonly OperationsApproval[];
  readonly role: 'office' | 'owner';
  readonly tenantName: string;
  readonly timeZone: string;
  readonly todayJobs: readonly OperationsJob[];
  readonly unassignedJobs: readonly OperationsJob[];
  readonly unpaidInvoices: readonly OperationsInvoice[];
};

type ApprovalSource = {
  readonly id: string;
  readonly job_id: string;
  readonly updated_at: string;
};

export function buildOperationsApprovals({
  invoices,
  jobs,
  quotes,
  reports,
}: Readonly<{
  invoices: readonly OperationsInvoice[];
  jobs: readonly Pick<OperationsJob, 'id' | 'title'>[];
  quotes: readonly OperationsQuote[];
  reports: readonly OperationsReport[];
}>): readonly OperationsApproval[] {
  const jobTitles = new Map(jobs.map((job) => [job.id, job.title]));
  const base = (source: ApprovalSource): OperationsApprovalBase => ({
    id: source.id,
    jobId: source.job_id,
    jobTitle: jobTitles.get(source.job_id) ?? 'Archived or unavailable job',
    updatedAt: source.updated_at,
  });

  return [
    ...quotes.map((quote) => ({
      ...base(quote),
      expiresAt: quote.expires_at,
      kind: 'quote' as const,
      totalCents: quote.total_cents,
    })),
    ...invoices
      .filter((invoice) => invoice.status === 'draft')
      .map((invoice) => ({
        ...base(invoice),
        dueAt: invoice.due_at,
        invoiceNumber: invoice.invoice_number,
        kind: 'invoice' as const,
        totalCents: invoice.total_cents,
      })),
    ...reports.map((report) => ({
      ...base(report),
      kind: 'report' as const,
      partsUsed: report.parts_used,
      recommendations: report.recommendations,
      summary: report.summary,
      workPerformed: report.work_performed,
    })),
  ].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

export function localDateKey(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function buildOperationsMetrics({
  approvals,
  invoices,
  jobs,
  now,
  payments,
  role,
  timeZone,
}: Readonly<{
  approvals: readonly ApprovalSource[];
  invoices: readonly OperationsInvoice[];
  jobs: readonly OperationsJob[];
  now: Date;
  payments: readonly OperationsPayment[];
  role: 'office' | 'owner';
  timeZone: string;
}>): OperationsMetrics {
  const today = localDateKey(now, timeZone);
  const currentMonth = today.slice(0, 7);
  const monthlyReceivedCents = payments
    .filter(
      (payment) =>
        localDateKey(new Date(payment.received_at), timeZone).slice(0, 7) ===
        currentMonth,
    )
    .reduce((total, payment) => total + payment.amount_cents, 0);

  return {
    activeCount: jobs.filter((job) =>
      ['scheduled', 'in_progress'].includes(job.status),
    ).length,
    ...(role === 'owner' ? { monthlyReceivedCents } : {}),
    openCount: jobs.filter(
      (job) => !['closed', 'cancelled'].includes(job.status),
    ).length,
    pendingApprovalCount: approvals.length,
    todayCount: jobs.filter(
      (job) =>
        job.scheduled_start_at &&
        localDateKey(new Date(job.scheduled_start_at), timeZone) === today,
    ).length,
    unassignedCount: jobs.filter(
      (job) =>
        !job.assigned_membership_id &&
        !['closed', 'cancelled'].includes(job.status),
    ).length,
    unpaidCount: invoices.filter((invoice) =>
      ['sent', 'partially_paid'].includes(invoice.status),
    ).length,
  };
}

export async function loadMobileOperations(
  client: SupabaseClient<Database>,
  membership: MobileMembership,
  now = new Date(),
): Promise<MobileOperationsSnapshot> {
  if (membership.role === 'technician') {
    throw new Error('Operations overview requires owner or office access.');
  }

  const paymentPromise =
    membership.role === 'owner'
      ? ownerPaymentsQuery(client, membership.tenant_id)
      : undefined;
  const [
    tenantResult,
    jobsResult,
    invoicesResult,
    quotesResult,
    reportsResult,
  ] = await Promise.all([
    client
      .from('tenants')
      .select('display_name, time_zone')
      .eq('id', membership.tenant_id)
      .single(),
    operationsJobsQuery(client, membership.tenant_id),
    operationsInvoicesQuery(client, membership.tenant_id),
    draftQuotesQuery(client, membership.tenant_id),
    draftReportsQuery(client, membership.tenant_id),
  ]);
  const paymentResult = paymentPromise ? await paymentPromise : undefined;

  if (
    tenantResult.error ||
    jobsResult.error ||
    invoicesResult.error ||
    quotesResult.error ||
    reportsResult.error ||
    paymentResult?.error
  ) {
    throw new Error('Mobile operations overview could not be loaded.');
  }

  const jobs = jobsResult.data ?? [];
  const invoices = invoicesResult.data ?? [];
  const pendingApprovals = buildOperationsApprovals({
    invoices,
    jobs,
    quotes: quotesResult.data ?? [],
    reports: reportsResult.data ?? [],
  });
  const timeZone = tenantResult.data.time_zone;
  const today = localDateKey(now, timeZone);
  const activeJob = (job: OperationsJob) =>
    !['closed', 'cancelled'].includes(job.status);

  return {
    jobs,
    metrics: buildOperationsMetrics({
      approvals: pendingApprovals.map((item) => ({
        id: item.id,
        job_id: item.jobId,
        updated_at: item.updatedAt,
      })),
      invoices,
      jobs,
      now,
      payments: paymentResult?.data ?? [],
      role: membership.role,
      timeZone,
    }),
    pendingApprovals,
    role: membership.role,
    tenantName: tenantResult.data.display_name,
    timeZone,
    todayJobs: jobs.filter(
      (job) =>
        job.scheduled_start_at &&
        localDateKey(new Date(job.scheduled_start_at), timeZone) === today,
    ),
    unassignedJobs: jobs.filter(
      (job) => !job.assigned_membership_id && activeJob(job),
    ),
    unpaidInvoices: invoices.filter((invoice) =>
      ['sent', 'partially_paid'].includes(invoice.status),
    ),
  };
}

export function formatUsdCents(amountCents: number): string {
  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    style: 'currency',
  }).format(amountCents / 100);
}
