import { notFound } from 'next/navigation';

import { createClient } from '../../../lib/supabase/server';
import { formatUsd, publicQuoteSchema } from '../../../lib/quotes/public-quote';
import { decideQuoteAction } from './actions';
import './styles.css';

export const dynamic = 'force-dynamic';

const tokenPattern = /^[0-9a-f]{64}$/;

export default async function PublicQuotePage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string; result?: string }>;
}>) {
  const { token } = await params;
  const feedback = await searchParams;
  if (!tokenPattern.test(token)) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_public_quote', {
    quote_token: token,
  });
  const parsed = publicQuoteSchema.safeParse(data);
  if (error || !parsed.success) notFound();
  const quote = parsed.data;
  const canDecide = quote.status === 'sent';

  return (
    <main className="public-quote-shell">
      <section className="public-quote-card">
        <header className="public-quote-header">
          <div className="public-quote-brand">
            <span>C</span> CrewFlow
          </div>
          <p>Prepared by {quote.company_name}</p>
        </header>
        <div className="public-quote-intro">
          <p className="public-quote-kicker">QUOTE FOR {quote.customer_name}</p>
          <h1>{quote.job_title}</h1>
          <p>
            Expires{' '}
            {new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(
              new Date(quote.expires_at),
            )}
          </p>
        </div>

        <div className="public-quote-lines">
          {quote.items.map((item, index) => (
            <div
              className="public-quote-line"
              key={`${item.description}-${index}`}
            >
              <div>
                <strong>{item.description}</strong>
                <span>
                  {item.quantity} × {formatUsd(item.unit_price_cents)}
                  {item.taxable ? '' : ' · non-taxable'}
                </span>
              </div>
              <strong>{formatUsd(item.line_total_cents)}</strong>
            </div>
          ))}
        </div>

        <dl className="public-quote-totals">
          <div>
            <dt>Subtotal</dt>
            <dd>{formatUsd(quote.subtotal_cents)}</dd>
          </div>
          {quote.discount_cents ? (
            <div>
              <dt>Discount</dt>
              <dd>-{formatUsd(quote.discount_cents)}</dd>
            </div>
          ) : null}
          <div>
            <dt>Tax</dt>
            <dd>{formatUsd(quote.tax_cents)}</dd>
          </div>
          <div className="public-quote-total">
            <dt>Total</dt>
            <dd>{formatUsd(quote.total_cents)}</dd>
          </div>
        </dl>

        {feedback.result ? (
          <p className="public-quote-success" role="status">
            Quote {feedback.result}. {quote.company_name} has been notified in
            CrewFlow.
          </p>
        ) : null}
        {feedback.error ? (
          <p className="public-quote-error" role="alert">
            This quote could not be updated. It may be expired or already
            decided.
          </p>
        ) : null}

        {canDecide ? (
          <div className="public-quote-actions">
            <form action={decideQuoteAction.bind(null, token, 'accepted')}>
              <button className="public-quote-accept" type="submit">
                Accept quote
              </button>
            </form>
            <form action={decideQuoteAction.bind(null, token, 'declined')}>
              <button className="public-quote-decline" type="submit">
                Decline
              </button>
            </form>
          </div>
        ) : (
          <p
            className={`public-quote-status public-quote-status-${quote.status}`}
          >
            This quote is {quote.status}.
          </p>
        )}

        <p className="public-quote-security">
          This secure link is only for this quote. CrewFlow does not collect
          your payment.
        </p>
      </section>
    </main>
  );
}
