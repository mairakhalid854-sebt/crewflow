import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
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

  it('adds a clickable Google review link when the business saved one', async () => {
    const reviewUrl = 'https://g.page/r/CrewFlowReview123/review';
    const reviewLinks = async (data: InvoicePdfData) => {
      const document = await PDFDocument.load(await createInvoicePdf(data));
      const annots = document
        .getPage(document.getPageCount() - 1)
        .node.lookupMaybe(PDFName.of('Annots'), PDFArray);
      if (!annots) return [];
      return annots.asArray().map((ref) => {
        const action = document.context
          .lookup(ref, PDFDict)
          .lookup(PDFName.of('A'), PDFDict);
        return action.lookup(PDFName.of('URI'), PDFString).decodeText();
      });
    };

    expect(
      await reviewLinks({ ...invoice, googleReviewUrl: reviewUrl }),
    ).toEqual([reviewUrl]);
    expect(await reviewLinks(invoice)).toEqual([]);
    expect(
      await reviewLinks({
        ...invoice,
        googleReviewUrl: reviewUrl,
        status: 'void',
        voidReason: 'Duplicate',
      }),
    ).toEqual([]);
  });
});
