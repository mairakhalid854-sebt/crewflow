'use client';

import { useActionState, useMemo, useState } from 'react';

import { formatUsd } from '../../../lib/quotes/public-quote';
import { type InvoiceActionState, saveInvoiceAction } from './invoice-actions';

type EditableInvoiceLine = {
  readonly description: string;
  readonly quantity: number;
  readonly taxable: boolean;
  readonly unitPrice: string;
};

const initialState: InvoiceActionState = { status: 'idle' };

function amount(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
}

export function InvoiceForm({
  discount,
  dueOn,
  initialLines,
  jobId,
  paymentUrl,
  taxRateBps,
}: Readonly<{
  discount: string;
  dueOn: string;
  initialLines: readonly EditableInvoiceLine[];
  jobId: string;
  paymentUrl: string;
  taxRateBps: number;
}>) {
  const [state, formAction, pending] = useActionState(
    saveInvoiceAction,
    initialState,
  );
  const [discountValue, setDiscountValue] = useState(discount);
  const [lines, setLines] = useState<EditableInvoiceLine[]>([...initialLines]);
  const preview = useMemo(() => {
    const subtotal = lines.reduce(
      (total, line) => total + line.quantity * amount(line.unitPrice) * 100,
      0,
    );
    const taxable = lines.reduce(
      (total, line) =>
        total +
        (line.taxable ? line.quantity * amount(line.unitPrice) * 100 : 0),
      0,
    );
    const discountCents = Math.min(amount(discountValue) * 100, subtotal);
    const taxableDiscount = subtotal
      ? Math.round((discountCents * taxable) / subtotal)
      : 0;
    const tax = Math.round(
      (Math.max(taxable - taxableDiscount, 0) * taxRateBps) / 10_000,
    );
    return {
      discount: Math.round(discountCents),
      subtotal: Math.round(subtotal),
      tax,
      total: Math.round(subtotal - discountCents + tax),
    };
  }, [discountValue, lines, taxRateBps]);

  function updateLine(index: number, update: Partial<EditableInvoiceLine>) {
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...update } : line,
      ),
    );
  }

  return (
    <form action={formAction} className="resource-form quote-form">
      <input name="jobId" type="hidden" value={jobId} />
      <div className="quote-editor-heading">
        <div>
          <h2>Invoice line items</h2>
          <p>Items and totals become immutable when this invoice is sent.</p>
        </div>
        <button
          className="secondary-button"
          disabled={pending || lines.length >= 50}
          onClick={() =>
            setLines((current) => [
              ...current,
              {
                description: '',
                quantity: 1,
                taxable: true,
                unitPrice: '0.00',
              },
            ])
          }
          type="button"
        >
          Add line
        </button>
      </div>

      <div className="quote-lines">
        {lines.map((line, index) => (
          <div className="quote-line" key={index}>
            <label className="quote-line-description">
              <span>Description</span>
              <input
                maxLength={240}
                name="description"
                onChange={(event) =>
                  updateLine(index, { description: event.target.value })
                }
                required
                value={line.description}
              />
            </label>
            <label>
              <span>Qty</span>
              <input
                max={999}
                min={1}
                name="quantity"
                onChange={(event) =>
                  updateLine(index, { quantity: Number(event.target.value) })
                }
                required
                step={1}
                type="number"
                value={line.quantity}
              />
            </label>
            <label>
              <span>Unit price</span>
              <input
                inputMode="decimal"
                max="1000000"
                min="0"
                name="unitPrice"
                onChange={(event) =>
                  updateLine(index, { unitPrice: event.target.value })
                }
                required
                step="0.01"
                type="number"
                value={line.unitPrice}
              />
            </label>
            <label className="checkbox-field quote-taxable">
              <input
                checked={line.taxable}
                name={`taxable-${index}`}
                onChange={(event) =>
                  updateLine(index, { taxable: event.target.checked })
                }
                type="checkbox"
              />
              Taxable
            </label>
            <button
              aria-label={`Remove line ${index + 1}`}
              className="quote-remove-line"
              disabled={pending || lines.length === 1}
              onClick={() =>
                setLines((current) =>
                  current.filter((_, lineIndex) => lineIndex !== index),
                )
              }
              type="button"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="form-grid quote-settings">
        <label>
          <span>Discount (USD)</span>
          <input
            min="0"
            name="discount"
            onChange={(event) => setDiscountValue(event.target.value)}
            required
            step="0.01"
            type="number"
            value={discountValue}
          />
        </label>
        <label>
          <span>Due on</span>
          <input defaultValue={dueOn} name="dueOn" required type="date" />
        </label>
      </div>

      <label>
        <span>Business-owned payment URL (optional)</span>
        <input
          defaultValue={paymentUrl}
          maxLength={2048}
          name="paymentUrl"
          placeholder="https://pay.your-provider.com/..."
          type="url"
        />
        <small className="form-help">
          Must use HTTPS and a public domain. CrewFlow does not process or
          confirm payments from this link.
        </small>
      </label>

      <dl className="quote-total-preview">
        <div>
          <dt>Subtotal</dt>
          <dd>{formatUsd(preview.subtotal)}</dd>
        </div>
        <div>
          <dt>Discount</dt>
          <dd>-{formatUsd(preview.discount)}</dd>
        </div>
        <div>
          <dt>Estimated tax</dt>
          <dd>{formatUsd(preview.tax)}</dd>
        </div>
        <div className="quote-total-row">
          <dt>Total</dt>
          <dd>{formatUsd(preview.total)}</dd>
        </div>
      </dl>

      {state.message ? (
        <p className={`form-status form-status-${state.status}`} role="status">
          {state.message}
        </p>
      ) : null}
      <button className="primary-button" disabled={pending} type="submit">
        {pending ? 'Saving...' : 'Save draft invoice'}
      </button>
    </form>
  );
}
