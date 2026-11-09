import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { LanguageSwitch } from '../../../components/language-switch';
import {
  dateLocale,
  publicCopy,
  resolvePublicLocale,
} from '../../../lib/i18n/public-copy';
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
  searchParams: Promise<{ error?: string; lang?: string; result?: string }>;
}>) {
  const { token } = await params;
  const feedback = await searchParams;
  if (!tokenPattern.test(token)) notFound();
  const locale = resolvePublicLocale(
    feedback.lang,
    (await headers()).get('accept-language'),
  );
  const t = publicCopy(locale);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_public_quote', {
    quote_token: token,
  });
  const parsed = publicQuoteSchema.safeParse(data);
  if (error || !parsed.success) notFound();
  const quote = parsed.data;
  const canDecide = quote.status === 'sent';

  return (
    <main className="public-quote-shell" lang={locale}>
      <section className="public-quote-card">
        <header className="public-quote-header">
          <div className="public-quote-brand">
            <span>C</span> CrewFlow360
          </div>
          <p>{t.common.preparedBy(quote.company_name)}</p>
        </header>
        <LanguageSwitch
          label={t.common.languageLabel}
          locale={locale}
          path={`/quote/${token}`}
        />
        <div className="public-quote-intro">
          <p className="public-quote-kicker">
            {t.quote.kicker(quote.customer_name)}
          </p>
          <h1>{quote.job_title}</h1>
          <p>
            {t.quote.expires}{' '}
            {new Intl.DateTimeFormat(dateLocale(locale), {
              dateStyle: 'long',
            }).format(new Date(quote.expires_at))}
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
                  {item.taxable ? '' : ` · ${t.common.nonTaxable}`}
                </span>
              </div>
              <strong>{formatUsd(item.line_total_cents)}</strong>
            </div>
          ))}
        </div>

        <dl className="public-quote-totals">
          <div>
            <dt>{t.common.subtotal}</dt>
            <dd>{formatUsd(quote.subtotal_cents)}</dd>
          </div>
          {quote.discount_cents ? (
            <div>
              <dt>{t.common.discount}</dt>
              <dd>-{formatUsd(quote.discount_cents)}</dd>
            </div>
          ) : null}
          <div>
            <dt>{t.common.tax}</dt>
            <dd>{formatUsd(quote.tax_cents)}</dd>
          </div>
          <div className="public-quote-total">
            <dt>{t.common.total}</dt>
            <dd>{formatUsd(quote.total_cents)}</dd>
          </div>
        </dl>

        {feedback.result ? (
          <p className="public-quote-success" role="status">
            {t.quote.result(feedback.result, quote.company_name)}
          </p>
        ) : null}
        {feedback.error ? (
          <p className="public-quote-error" role="alert">
            {t.quote.error}
          </p>
        ) : null}

        {canDecide ? (
          <div className="public-quote-actions">
            <form action={decideQuoteAction.bind(null, token, 'accepted')}>
              <button className="public-quote-accept" type="submit">
                {t.quote.accept}
              </button>
            </form>
            <form action={decideQuoteAction.bind(null, token, 'declined')}>
              <button className="public-quote-decline" type="submit">
                {t.quote.decline}
              </button>
            </form>
          </div>
        ) : (
          <p
            className={`public-quote-status public-quote-status-${quote.status}`}
          >
            {t.quote.status(quote.status)}
          </p>
        )}

        <p className="public-quote-security">{t.quote.security}</p>
      </section>
    </main>
  );
}
