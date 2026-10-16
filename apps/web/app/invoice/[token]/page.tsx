import { notFound } from 'next/navigation';

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
}: Readonly<{ params: Promise<{ token: string }> }>) {
  const { token } = await params;
  if (!tokenPattern.test(token)) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_public_invoice', {
    invoice_token: token,
  });
  const parsed = publicInvoiceSchema.safeParse(data);
  if (error || !parsed.success) notFound();
  const invoice = parsed.data;

  return (
    <main className="public-quote-shell">
      <section className="public-quote-card">
        <header className="public-quote-header">
          <div className="public-quote-brand">
            <span>C</span> CrewFlow
          </div>
          <p>Prepared by {invoice.company_name}</p>
        </header>
        <div className="public-quote-intro">
          <p className="public-quote-kicker">
            INVOICE {formatInvoiceNumber(invoice.invoice_number)}
          </p>
          <h1>{invoice.job_title}</h1>
          <p>For {invoice.customer_name}</p>
          <p>
            Due{' '}
            {new Intl.DateTimeFormat('en-US', {
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
                  {item.taxable ? '' : ' - non-taxable'}
                </span>
              </div>
              <strong>{formatUsd(item.line_total_cents)}</strong>
            </div>
          ))}
        </div>

        <dl className="public-quote-totals">
          <div>
            <dt>Subtotal</dt>
            <dd>{formatUsd(invoice.subtotal_cents)}</dd>
          </div>
          {invoice.discount_cents ? (
            <div>
              <dt>Discount</dt>
              <dd>-{formatUsd(invoice.discount_cents)}</dd>
            </div>
          ) : null}
          <div>
            <dt>Tax</dt>
            <dd>{formatUsd(invoice.tax_cents)}</dd>
          </div>
          <div>
            <dt>Recorded paid</dt>
            <dd>{formatUsd(invoice.paid_cents)}</dd>
          </div>
          <div className="public-quote-total">
            <dt>Outstanding</dt>
            <dd>{formatUsd(invoice.outstanding_cents)}</dd>
          </div>
        </dl>

        <div className="public-invoice-download">
          <a download href={`/invoice/${token}/pdf`}>
            Download{' '}
            {invoice.status === 'paid' ? 'paid receipt' : 'invoice PDF'}
          </a>
        </div>

        {invoice.status === 'void' ? (
          <p className="public-quote-error" role="status">
            This invoice is void. {invoice.void_reason}
          </p>
        ) : invoice.status === 'paid' ? (
          <p className="public-quote-success" role="status">
            This invoice is recorded as paid by {invoice.company_name}.
          </p>
        ) : invoice.payment_url ? (
          <div className="public-quote-actions public-invoice-payment">
            <a
              className="public-quote-accept"
              href={invoice.payment_url}
              rel="noreferrer noopener"
              target="_blank"
            >
              Open {invoice.company_name}&apos;s payment page
            </a>
            <p>
              You will leave CrewFlow. The service business—not CrewFlow—is the
              payee and controls that page.
            </p>
          </div>
        ) : (
          <p className="public-quote-status">
            Contact {invoice.company_name} for payment instructions.
          </p>
        )}

        <p className="public-quote-security">
          Opening an external payment page never marks this invoice paid.
          CrewFlow updates the balance only after the business records or
          verifies receipt.
        </p>
      </section>
    </main>
  );
}
