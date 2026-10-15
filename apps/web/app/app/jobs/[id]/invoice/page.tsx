import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireTenantContext } from '../../../../../lib/auth/tenant-context';
import { createClient } from '../../../../../lib/supabase/server';
import { InvoiceForm } from '../../invoice-form';

export const dynamic = 'force-dynamic';

function localDate(value: string | undefined, timeZone: string): string {
  const date = value ? new Date(value) : new Date(Date.now() + 14 * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export default async function JobInvoicePage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const context = await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('id, service_id, status, title')
    .eq('id', id)
    .eq('tenant_id', context.tenantId)
    .is('archived_at', null)
    .maybeSingle();
  if (jobError) throw new Error('Job could not be loaded.');
  if (!job || !['completed', 'closed'].includes(job.status)) notFound();

  const [draftResult, quoteResult, serviceResult, tenantResult] =
    await Promise.all([
      supabase
        .from('invoices')
        .select('*')
        .eq('tenant_id', context.tenantId)
        .eq('job_id', job.id)
        .eq('status', 'draft')
        .maybeSingle(),
      supabase
        .from('quotes')
        .select('*')
        .eq('tenant_id', context.tenantId)
        .eq('job_id', job.id)
        .eq('status', 'accepted')
        .order('accepted_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      job.service_id
        ? supabase
            .from('services')
            .select('name, tax_behavior, unit_price_cents')
            .eq('id', job.service_id)
            .eq('tenant_id', context.tenantId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from('tenants')
        .select('tax_rate_bps')
        .eq('id', context.tenantId)
        .single(),
    ]);
  if (
    draftResult.error ||
    quoteResult.error ||
    serviceResult.error ||
    tenantResult.error
  ) {
    throw new Error('Invoice editor could not be loaded.');
  }

  const draft = draftResult.data;
  const acceptedQuote = quoteResult.data;
  const { data: sourceLines, error: linesError } = draft
    ? await supabase
        .from('invoice_line_items')
        .select('description, quantity, taxable, unit_price_cents')
        .eq('tenant_id', context.tenantId)
        .eq('invoice_id', draft.id)
        .order('position')
    : acceptedQuote
      ? await supabase
          .from('quote_line_items')
          .select('description, quantity, taxable, unit_price_cents')
          .eq('tenant_id', context.tenantId)
          .eq('quote_id', acceptedQuote.id)
          .order('position')
      : { data: null, error: null };
  if (linesError) throw new Error('Invoice line items could not be loaded.');

  const service = serviceResult.data;
  const initialLines = sourceLines?.length
    ? sourceLines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        taxable: line.taxable,
        unitPrice: (line.unit_price_cents / 100).toFixed(2),
      }))
    : [
        {
          description: service?.name ?? job.title,
          quantity: 1,
          taxable: service?.tax_behavior !== 'non_taxable',
          unitPrice: ((service?.unit_price_cents ?? 0) / 100).toFixed(2),
        },
      ];

  return (
    <div className="workspace-page resource-editor-page">
      <Link className="back-link" href={`/app/jobs/${job.id}`}>
        Back to job
      </Link>
      <header className="resource-editor-header">
        <p className="workspace-kicker">INVOICE DRAFT</p>
        <h1>{job.title}</h1>
        <p>
          Review billable work, tax, due date, and the business-owned payment
          link before sending.
        </p>
      </header>
      <InvoiceForm
        discount={(
          (draft?.discount_cents ?? acceptedQuote?.discount_cents ?? 0) / 100
        ).toFixed(2)}
        dueOn={localDate(draft?.due_at, context.timeZone)}
        initialLines={initialLines}
        jobId={job.id}
        paymentUrl={draft?.payment_url ?? ''}
        taxRateBps={tenantResult.data.tax_rate_bps}
      />
    </div>
  );
}
