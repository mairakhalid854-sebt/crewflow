'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

import type { Database, Tables } from '@crewflow/database';

import { formatInvoiceNumber } from '../../../lib/invoices/public-invoice';
import { formatUsd } from '../../../lib/quotes/public-quote';
import {
  type InvoiceActionState,
  publishInvoiceAction,
  recordAdjustmentAction,
  recordPaymentAction,
  requestAiInvoiceProposalAction,
  voidInvoiceAction,
} from './invoice-actions';

type Invoice = Tables<'invoices'>;
type InvoiceLine = Tables<'invoice_line_items'>;
type PaymentRecord = Tables<'payment_records'>;
type MembershipRole = Database['public']['Enums']['membership_role'];

const initialState: InvoiceActionState = { status: 'idle' };

export function InvoicePanel({
  invoice,
  jobId,
  jobStatus,
  lines,
  payments,
  receivedAtLocal,
  role,
  timeZone,
}: Readonly<{
  invoice?: Invoice;
  jobId: string;
  jobStatus: string;
  lines: readonly InvoiceLine[];
  payments: readonly PaymentRecord[];
  receivedAtLocal: string;
  role: MembershipRole;
  timeZone: string;
}>) {
  const [publishState, publishAction, publishing] = useActionState(
    publishInvoiceAction,
    initialState,
  );
  const [paymentState, paymentAction, recording] = useActionState(
    recordPaymentAction,
    initialState,
  );
  const [adjustmentState, adjustmentAction, adjusting] = useActionState(
    recordAdjustmentAction,
    initialState,
  );
  const [voidState, voidAction, voiding] = useActionState(
    voidInvoiceAction,
    initialState,
  );
  const [proposalState, proposalAction, proposing] = useActionState(
    requestAiInvoiceProposalAction,
    initialState,
  );
  const [copied, setCopied] = useState(false);
  const jobCanInvoice = ['completed', 'closed'].includes(jobStatus);
  const canCreate = jobCanInvoice && (!invoice || invoice.status === 'void');
  const outstanding = invoice ? invoice.total_cents - invoice.paid_cents : 0;

  return (
    <section className="team-panel quote-panel invoice-panel">
      <div className="team-panel-heading">
        <div>
          <h2>Invoice</h2>
          <p>Billing snapshot and manually verified payment history.</p>
        </div>
        <div className="panel-heading-actions">
          {canCreate ? (
            <form action={proposalAction}>
              <input name="jobId" type="hidden" value={jobId} />
              <button
                className="secondary-button"
                disabled={proposing}
                type="submit"
              >
                {proposing ? 'Evaluating...' : 'Prepare AI draft'}
              </button>
            </form>
          ) : null}
          {invoice ? (
            <a
              className="secondary-button"
              download
              href={`/app/invoices/${invoice.id}/pdf`}
            >
              Download {invoice.status === 'paid' ? 'receipt' : 'PDF'}
            </a>
          ) : null}
          {invoice?.status === 'draft' || canCreate ? (
            <Link
              className="secondary-button"
              href={`/app/jobs/${jobId}/invoice`}
            >
              {invoice?.status === 'draft'
                ? 'Edit draft'
                : invoice
                  ? 'Create replacement'
                  : 'Create invoice'}
            </Link>
          ) : null}
        </div>
      </div>

      {proposalState.message ? (
        <p
          className={`form-status form-status-${proposalState.status}`}
          role="status"
        >
          {proposalState.message}
        </p>
      ) : null}

      {!invoice ? (
        <p className="form-help">
          {jobCanInvoice
            ? 'No invoice has been created for this job.'
            : 'Invoice creation becomes available when the job is completed.'}
        </p>
      ) : (
        <>
          <div className="quote-summary-row">
            <span className={`status-badge status-invoice-${invoice.status}`}>
              {invoice.status.replace('_', ' ')}
            </span>
            <strong>{formatInvoiceNumber(invoice.invoice_number)}</strong>
            <span>{formatUsd(invoice.total_cents)} total</span>
          </div>
          <dl className="quote-total-preview quote-panel-totals">
            <div>
              <dt>Total</dt>
              <dd>{formatUsd(invoice.total_cents)}</dd>
            </div>
            <div>
              <dt>Recorded paid</dt>
              <dd>{formatUsd(invoice.paid_cents)}</dd>
            </div>
            <div className="quote-total-row">
              <dt>Outstanding</dt>
              <dd>{formatUsd(outstanding)}</dd>
            </div>
          </dl>

          {invoice.status === 'draft' ? (
            <form action={publishAction} className="quote-publish-form">
              <input name="invoiceId" type="hidden" value={invoice.id} />
              <input name="jobId" type="hidden" value={jobId} />
              <p className="form-help">
                Sending locks {lines.length} line item
                {lines.length === 1 ? '' : 's'} and creates a secure customer
                link.
              </p>
              <button
                className="primary-button"
                disabled={publishing}
                type="submit"
              >
                {publishing ? 'Creating secure link...' : 'Send invoice'}
              </button>
            </form>
          ) : (
            <p className="form-help">
              The customer link was shown once when sent. Invoice links never
              confirm payment automatically.
            </p>
          )}

          {invoice.payment_url ? (
            <p className="invoice-provider-note">
              External payment page:{' '}
              <a href={invoice.payment_url} rel="noreferrer" target="_blank">
                {new URL(invoice.payment_url).hostname}
              </a>
            </p>
          ) : null}

          {['sent', 'partially_paid'].includes(invoice.status) ? (
            <form action={paymentAction} className="invoice-ledger-form">
              <input name="invoiceId" type="hidden" value={invoice.id} />
              <input name="jobId" type="hidden" value={jobId} />
              <h3>Record payment received</h3>
              <p className="form-help">
                Use only after the business verifies funds received outside
                CrewFlow.
              </p>
              <div className="form-grid">
                <label>
                  <span>Amount (USD)</span>
                  <input
                    defaultValue={(outstanding / 100).toFixed(2)}
                    min="0.01"
                    name="amount"
                    required
                    step="0.01"
                    type="number"
                  />
                </label>
                <label>
                  <span>Method</span>
                  <select defaultValue="cash" name="method">
                    <option value="cash">Cash</option>
                    <option value="check">Check</option>
                    <option value="external_transfer">External transfer</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label>
                  <span>Received at ({timeZone})</span>
                  <input
                    defaultValue={receivedAtLocal}
                    name="receivedAt"
                    required
                    type="datetime-local"
                  />
                </label>
                <label>
                  <span>Reference (optional)</span>
                  <input maxLength={160} name="reference" />
                </label>
              </div>
              <label>
                <span>Note (optional)</span>
                <textarea maxLength={500} name="note" rows={2} />
              </label>
              {paymentState.message ? (
                <p
                  className={`form-status form-status-${paymentState.status}`}
                  role="status"
                >
                  {paymentState.message}
                </p>
              ) : null}
              <button
                className="primary-button"
                disabled={recording}
                type="submit"
              >
                {recording ? 'Recording...' : 'Record manual payment'}
              </button>
            </form>
          ) : null}

          {role === 'owner' &&
          ['sent', 'partially_paid', 'paid'].includes(invoice.status) ? (
            <form action={adjustmentAction} className="invoice-ledger-form">
              <input name="invoiceId" type="hidden" value={invoice.id} />
              <input name="jobId" type="hidden" value={jobId} />
              <h3>Owner ledger adjustment</h3>
              <p className="form-help">
                Use a negative amount to correct a previously recorded payment.
                The original entry remains in history.
              </p>
              <div className="form-grid">
                <label>
                  <span>Adjustment (USD)</span>
                  <input name="amount" required step="0.01" type="number" />
                </label>
                <label>
                  <span>Reason</span>
                  <input maxLength={500} minLength={3} name="reason" required />
                </label>
              </div>
              {adjustmentState.message ? (
                <p
                  className={`form-status form-status-${adjustmentState.status}`}
                  role="status"
                >
                  {adjustmentState.message}
                </p>
              ) : null}
              <button
                className="secondary-button"
                disabled={adjusting}
                type="submit"
              >
                {adjusting ? 'Recording...' : 'Record adjustment'}
              </button>
            </form>
          ) : null}

          {payments.length ? (
            <div className="invoice-ledger">
              <h3>Payment ledger</h3>
              <ol className="activity-list">
                {payments.map((payment) => (
                  <li key={payment.id}>
                    <strong>
                      {payment.record_type === 'adjustment'
                        ? 'Adjustment'
                        : payment.method.replace('_', ' ')}{' '}
                      {formatUsd(payment.amount_cents)}
                    </strong>
                    <span>{payment.source.replace('_', ' ')}</span>
                    <time dateTime={payment.received_at}>
                      {new Intl.DateTimeFormat('en-US', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                        timeZone,
                      }).format(new Date(payment.received_at))}
                    </time>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {role === 'owner' &&
          invoice.paid_cents === 0 &&
          ['draft', 'sent'].includes(invoice.status) ? (
            <form action={voidAction} className="invoice-void-form">
              <input name="invoiceId" type="hidden" value={invoice.id} />
              <input name="jobId" type="hidden" value={jobId} />
              <label>
                <span>Void reason</span>
                <input maxLength={500} minLength={3} name="reason" required />
              </label>
              <button
                className="danger-button"
                disabled={voiding}
                type="submit"
              >
                {voiding ? 'Voiding...' : 'Void invoice'}
              </button>
              {voidState.message ? (
                <p className={`form-status form-status-${voidState.status}`}>
                  {voidState.message}
                </p>
              ) : null}
            </form>
          ) : null}
        </>
      )}

      {publishState.message ? (
        <p
          className={`form-status form-status-${publishState.status}`}
          role="status"
        >
          {publishState.message}
        </p>
      ) : null}
      {publishState.shareUrl ? (
        <div className="secure-link-result">
          <label>
            Secure customer invoice link
            <input readOnly value={publishState.shareUrl} />
          </label>
          <button
            className="secondary-button"
            onClick={() => {
              void navigator.clipboard.writeText(publishState.shareUrl ?? '');
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
