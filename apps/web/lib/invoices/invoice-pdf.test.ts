import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import {
  createInvoicePdf,
  invoicePdfFileName,
  type InvoicePdfData,
} from './invoice-pdf';

const invoice: InvoicePdfData = {
  companyName: 'CrewFlow HVAC',
  customerName: 'Alex Morgan',
  discountCents: 2500,
  dueAt: '2026-11-01T07:59:00Z',
  invoiceNumber: 42,
  items: [
    {
      description: 'Air conditioner diagnostic and capacitor replacement',
      lineTotalCents: 17_500,
      quantity: 1,
      taxable: true,
      unitPriceCents: 17_500,
    },
  ],
  jobTitle: 'Air conditioner repair',
  outstandingCents: 16_400,
  paidCents: 0,
  status: 'sent',
  subtotalCents: 17_500,
  taxCents: 1400,
  timeZone: 'America/Los_Angeles',
  totalCents: 16_400,
  voidReason: null,
};

describe('invoice PDF', () => {
  it('creates a valid invoice document with stable metadata and filename', async () => {
    const bytes = await createInvoicePdf(invoice);
    const document = await PDFDocument.load(bytes);

    expect(document.getPageCount()).toBe(1);
    expect(document.getTitle()).toBe('Invoice INV-000042');
    expect(invoicePdfFileName(invoice)).toBe('invoice-INV-000042.pdf');
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('uses a receipt filename and paginates long item lists', async () => {
    const paidInvoice: InvoicePdfData = {
      ...invoice,
      items: Array.from({ length: 35 }, (_, index) => ({
        description: `Service line ${index + 1} with a detailed customer-facing description`,
        lineTotalCents: 100,
        quantity: 1,
        taxable: false,
        unitPriceCents: 100,
      })),
      outstandingCents: 0,
      paidCents: 3500,
      status: 'paid',
      subtotalCents: 3500,
      taxCents: 0,
      totalCents: 3500,
    };
    const bytes = await createInvoicePdf(paidInvoice);
    const document = await PDFDocument.load(bytes);

    expect(document.getPageCount()).toBeGreaterThan(1);
    expect(document.getTitle()).toBe('Receipt INV-000042');
    expect(invoicePdfFileName(paidInvoice)).toBe('receipt-INV-000042.pdf');
  });
});
