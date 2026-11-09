import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { LanguageSwitch } from '../../../components/language-switch';
import {
  dateLocale,
  publicCopy,
  resolvePublicLocale,
} from '../../../lib/i18n/public-copy';
import {
  formatInvoiceNumber,
  publicInvoiceSchema,
} from '../../../lib/invoices/public-invoice';
import { formatUsd } from '../../../lib/quotes/public-quote';
import { createClient } from '../../../lib/supabase/server';
import '../../quote/[token]/styles.css';

export const dynamic = 'force-dynamic';

const tokenPattern = /^[0-9a-f]{64}$/;

export default async function PublicInvoicePage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string }>;
}>) {
  const { token } = await params;
  if (!tokenPattern.test(token)) notFound();
  const locale = resolvePublicLocale(
    (await searchParams).lang,
    (await headers()).get('accept-language'),
  );
  const t = publicCopy(locale);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_public_invoice', {
    invoice_token: token,
  });
  const parsed = publicInvoiceSchema.safeParse(data);
  if (error || !parsed.success) notFound();
  const invoice = parsed.data;

  return (
    <main className="public-quote-shell" lang={locale}>
      <section className="public-quote-card">
        <header className="public-quote-header">
          <div className="public-quote-brand">
            <span>C</span> CrewFlow360
          </div>
          <p>{t.common.preparedBy(invoice.company_name)}</p>
        </header>
        <LanguageSwitch
          label={t.common.languageLabel}
          locale={locale}
          path={`/invoice/${token}`}
        />
        <div className="public-quote-intro">
          <p className="public-quote-kicker">
            {t.invoice.kicker(formatInvoiceNumber(invoice.invoice_number))}
          </p>
          <h1>{invoice.job_title}</h1>
          <p>{t.invoice.for(invoice.customer_name)}</p>
          <p>
            {t.invoice.due}{' '}
            {new Intl.DateTimeFormat(dateLocale(locale), {
              dateStyle: 'long',
              timeZone: invoice.company_time_zone,
            }).format(new Date(invoice.due_at))}
          </p>
        </div>

        <div className="public-quote-lines">
          {invoice.items.map((item, index) => (
            <div
              className="public-quote-line"
              key={`${item.description}-${index}`}
            >
              <div>
                <strong>{item.description}</strong>
                <span>
                  {item.quantity} x {formatUsd(item.unit_price_cents)}
                  {item.taxable ? '' : ` - ${t.common.nonTaxable}`}
                </span>
              </div>
              <strong>{formatUsd(item.line_total_cents)}</strong>
            </div>
          ))}
        </div>

        <dl className="public-quote-totals">
          <div>
            <dt>{t.common.subtotal}</dt>
            <dd>{formatUsd(invoice.subtotal_cents)}</dd>
          </div>
          {invoice.discount_cents ? (
            <div>
              <dt>{t.common.discount}</dt>
              <dd>-{formatUsd(invoice.discount_cents)}</dd>
            </div>
          ) : null}
          <div>
            <dt>{t.common.tax}</dt>
            <dd>{formatUsd(invoice.tax_cents)}</dd>
          </div>
          <div>
            <dt>{t.invoice.recordedPaid}</dt>
            <dd>{formatUsd(invoice.paid_cents)}</dd>
          </div>
          <div className="public-quote-total">
            <dt>{t.invoice.outstanding}</dt>
            <dd>{formatUsd(invoice.outstanding_cents)}</dd>
          </div>
        </dl>

        <div className="public-invoice-download">
          <a download href={`/invoice/${token}/pdf`}>
            {t.invoice.download(invoice.status === 'paid')}
          </a>
        </div>

        {invoice.status === 'void' ? (
          <p className="public-quote-error" role="status">
            {t.invoice.void} {invoice.void_reason}
          </p>
        ) : invoice.status === 'paid' ? (
          <p className="public-quote-success" role="status">
            {t.invoice.paid(invoice.company_name)}
          </p>
        ) : invoice.payment_url ? (
          <div className="public-quote-actions public-invoice-payment">
            <a
              className="public-quote-accept"
              href={invoice.payment_url}
              rel="noreferrer noopener"
              target="_blank"
            >
              {t.invoice.payButton(invoice.company_name)}
            </a>
            <p>{t.invoice.leaveNotice}</p>
          </div>
        ) : (
          <p className="public-quote-status">
            {t.invoice.contactForPayment(invoice.company_name)}
          </p>
        )}

        <p className="public-quote-security">{t.invoice.security}</p>
      </section>
    </main>
  );
}
