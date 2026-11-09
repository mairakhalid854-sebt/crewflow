import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireTenantContext } from '../../../../../lib/auth/tenant-context';
import { createClient } from '../../../../../lib/supabase/server';
import { QuoteAssistantForm } from '../../quote-assistant-form';
import { QuoteForm } from '../../quote-form';

const DRAFT_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AiDraftLine {
  readonly description: string;
  readonly quantity: number;
  readonly reason: string;
  readonly taxable: boolean;
  readonly unitPriceCents: number;
}

function parseAiLines(value: unknown): AiDraftLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((line: unknown) => {
    if (!line || typeof line !== 'object') return [];
    const item = line as Record<string, unknown>;
    if (
      typeof item.description !== 'string' ||
      typeof item.quantity !== 'number' ||
      typeof item.unitPriceCents !== 'number' ||
      typeof item.taxable !== 'boolean'
    ) {
      return [];
    }
    return [
      {
        description: item.description,
        quantity: item.quantity,
        reason: typeof item.reason === 'string' ? item.reason : '',
        taxable: item.taxable,
        unitPriceCents: item.unitPriceCents,
      },
    ];
  });
}

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
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aiDraft?: string }>;
}>) {
  const { id } = await params;
  const { aiDraft } = await searchParams;
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
  const aiDraftRow =
    aiDraft && DRAFT_UUID.test(aiDraft)
      ? (
          await supabase
            .from('ai_quote_drafts')
            .select('lines, missing_information, summary')
            .eq('id', aiDraft)
            .eq('tenant_id', context.tenantId)
            .eq('job_id', job.id)
            .maybeSingle()
        ).data
      : null;
  const aiLines = parseAiLines(aiDraftRow?.lines);
  const initialLines = aiLines.length
    ? aiLines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        taxable: line.taxable,
        unitPrice: (line.unitPriceCents / 100).toFixed(2),
      }))
    : existingLines?.length
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
      <section className="quote-assistant" aria-labelledby="quote-ai-title">
        <h2 id="quote-ai-title">AI quote assistant</h2>
        <p>
          Paste or type the customer&apos;s request. AI picks matching services
          from your price list; prices always come from your price list. Review
          everything before saving or sending.
        </p>
        {aiDraftRow ? (
          <div className="quote-assistant-result" role="status">
            <p>
              <strong>AI draft loaded into the form below.</strong>{' '}
              {aiDraftRow.summary}
            </p>
            {aiLines.length === 0 ? (
              <p>
                No service in your price list matched these notes, so the form
                was left as it was.
              </p>
            ) : (
              <ul>
                {aiLines.map((line, index) => (
                  <li key={`${line.description}-${index}`}>
                    {line.quantity} × {line.description}
                    {line.reason ? ` — ${line.reason}` : ''}
                  </li>
                ))}
              </ul>
            )}
            {aiDraftRow.missing_information.length ? (
              <>
                <p>
                  <strong>Ask the customer:</strong>
                </p>
                <ul>
                  {aiDraftRow.missing_information.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
        <QuoteAssistantForm jobId={job.id} />
      </section>
      <QuoteForm
        key={aiDraft ?? 'quote'}
        discount={((draft?.discount_cents ?? 0) / 100).toFixed(2)}
        expiresOn={dateInputValue(draft?.expires_at, context.timeZone)}
        initialLines={initialLines}
        jobId={job.id}
        taxRateBps={tenantResult.data.tax_rate_bps}
      />
    </div>
  );
}
