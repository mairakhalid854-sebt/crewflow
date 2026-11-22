'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

import type { Tables } from '@crewflow/database';

import { formatUsd } from '../../../lib/quotes/public-quote';
import { type QuoteFormState, publishQuoteAction } from './quote-actions';

type Quote = Tables<'quotes'>;
type QuoteLineItem = Tables<'quote_line_items'>;

const initialState: QuoteFormState = { status: 'idle' };

// The quote editor (and the AI quote assistant on it) only opens for jobs that
// are still New or Quoted; the database rejects quotes for later stages.
const quotableJobStatuses: readonly string[] = ['new', 'quoted'];

export function QuotePanel({
  jobId,
  jobStatus,
  lines,
  quote,
}: Readonly<{
  jobId: string;
  jobStatus: string;
  lines: readonly QuoteLineItem[];
  quote?: Quote;
}>) {
  const [state, formAction, pending] = useActionState(
    publishQuoteAction,
    initialState,
  );
  const [copied, setCopied] = useState(false);
  const jobIsQuotable = quotableJobStatuses.includes(jobStatus);
  const canCreateRevision =
    quote && ['sent', 'declined', 'expired', 'void'].includes(quote.status);

  return (
    <section className="team-panel quote-panel">
      <div className="team-panel-heading">
        <div>
          <h2>Quote</h2>
          <p>Customer pricing and secure acceptance.</p>
        </div>
        {jobIsQuotable &&
        (quote?.status === 'draft' || !quote || canCreateRevision) ? (
          <Link className="secondary-button" href={`/app/jobs/${jobId}/quote`}>
            {quote?.status === 'draft'
              ? 'Edit draft'
              : canCreateRevision
                ? 'Create revision'
                : 'Create quote'}
          </Link>
        ) : null}
      </div>

      {!jobIsQuotable &&
      (!quote || quote.status === 'draft' || canCreateRevision) ? (
        <p className="form-help">
          Quotes, including AI quote drafts, can only be created while the job
          is New or Quoted. This job has moved past quoting.
        </p>
      ) : null}

      {!quote ? (
        jobIsQuotable ? (
          <p className="form-help">
            No quote has been created for this job. Open Create quote to write
            one or draft it with AI.
          </p>
        ) : null
      ) : (
        <>
          <div className="quote-summary-row">
            <span className={`status-badge status-quote-${quote.status}`}>
              {quote.status}
            </span>
            <strong>{formatUsd(quote.total_cents)}</strong>
            <span>
              {lines.length} line item{lines.length === 1 ? '' : 's'}
            </span>
          </div>
          <dl className="quote-total-preview quote-panel-totals">
            <div>
              <dt>Subtotal</dt>
              <dd>{formatUsd(quote.subtotal_cents)}</dd>
            </div>
            <div>
              <dt>Discount</dt>
              <dd>-{formatUsd(quote.discount_cents)}</dd>
            </div>
            <div>
              <dt>Tax</dt>
              <dd>{formatUsd(quote.tax_cents)}</dd>
            </div>
            <div className="quote-total-row">
              <dt>Total</dt>
              <dd>{formatUsd(quote.total_cents)}</dd>
            </div>
          </dl>

          {quote.status === 'draft' ? (
            <form action={formAction} className="quote-publish-form">
              <input name="jobId" type="hidden" value={jobId} />
              <input name="quoteId" type="hidden" value={quote.id} />
              <p className="form-help">
                Sending locks this snapshot and advances a new job to Quoted.
              </p>
              <label className="checkbox-field">
                <input name="emailLink" type="checkbox" />
                Also email the link to the customer
              </label>
              <button
                className="primary-button"
                disabled={pending}
                type="submit"
              >
                {pending
                  ? 'Creating secure link...'
                  : 'Send and create customer link'}
              </button>
            </form>
          ) : (
            <p className="form-help">
              Raw customer links are shown only once. Create a new draft to
              rotate a lost link.
            </p>
          )}
        </>
      )}

      {state.message ? (
        <p className={`form-status form-status-${state.status}`} role="status">
          {state.message}
        </p>
      ) : null}
      {state.shareUrl ? (
        <div className="secure-link-result">
          <label>
            Secure customer link
            <input readOnly value={state.shareUrl} />
          </label>
          <button
            className="secondary-button"
            onClick={() => {
              void navigator.clipboard.writeText(state.shareUrl ?? '');
              setCopied(true);
            }}
            type="button"
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
