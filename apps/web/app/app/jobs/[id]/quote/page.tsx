import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireTenantContext } from '../../../../../lib/auth/tenant-context';
import { createClient } from '../../../../../lib/supabase/server';
import { QuoteForm } from '../../quote-form';

export const dynamic = 'force-dynamic';

function dateInputValue(value: string | undefined, timeZone: string): string {
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

export default async function JobQuotePage({
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
  if (!job || !['new', 'quoted'].includes(job.status)) notFound();

  const [draftResult, serviceResult, tenantResult] = await Promise.all([
    supabase
      .from('quotes')
      .select('*')
      .eq('tenant_id', context.tenantId)
      .eq('job_id', job.id)
      .eq('status', 'draft')
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
  if (draftResult.error || serviceResult.error || tenantResult.error) {
    throw new Error('Quote editor could not be loaded.');
  }

  const draft = draftResult.data;
  const { data: existingLines, error: linesError } = draft
    ? await supabase
        .from('quote_line_items')
        .select('*')
        .eq('tenant_id', context.tenantId)
        .eq('quote_id', draft.id)
        .order('position')
    : { data: null, error: null };
  if (linesError) throw new Error('Quote line items could not be loaded.');

  const service = serviceResult.data;
  const initialLines = existingLines?.length
    ? existingLines.map((line) => ({
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
        <p className="workspace-kicker">QUOTE DRAFT</p>
        <h1>{job.title}</h1>
        <p>
          Review customer pricing, tax, discount, and expiration before sending.
        </p>
      </header>
      <QuoteForm
        discount={((draft?.discount_cents ?? 0) / 100).toFixed(2)}
        expiresOn={dateInputValue(draft?.expires_at, context.timeZone)}
        initialLines={initialLines}
        jobId={job.id}
        taxRateBps={tenantResult.data.tax_rate_bps}
      />
    </div>
  );
}
