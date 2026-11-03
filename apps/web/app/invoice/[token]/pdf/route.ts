import { publicInvoiceSchema } from '../../../../lib/invoices/public-invoice';
import {
  createInvoicePdf,
  invoicePdfFileName,
  type InvoicePdfData,
} from '../../../../lib/invoices/invoice-pdf';
import { createClient } from '../../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

const tokenPattern = /^[0-9a-f]{64}$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!tokenPattern.test(token)) return new Response(null, { status: 404 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_public_invoice', {
    invoice_token: token,
  });
  const parsed = publicInvoiceSchema.safeParse(data);
  if (error || !parsed.success) return new Response(null, { status: 404 });
  const invoice = parsed.data;
  const pdfData: InvoicePdfData = {
    companyName: invoice.company_name,
    customerName: invoice.customer_name,
    discountCents: invoice.discount_cents,
    dueAt: invoice.due_at,
    invoiceNumber: invoice.invoice_number,
    items: invoice.items.map((item) => ({
      description: item.description,
      lineTotalCents: item.line_total_cents,
      quantity: item.quantity,
      taxable: item.taxable,
      unitPriceCents: item.unit_price_cents,
    })),
    jobTitle: invoice.job_title,
    outstandingCents: invoice.outstanding_cents,
    paidCents: invoice.paid_cents,
    status: invoice.status,
    subtotalCents: invoice.subtotal_cents,
    taxCents: invoice.tax_cents,
    timeZone: invoice.company_time_zone,
    totalCents: invoice.total_cents,
    voidReason: invoice.void_reason,
  };
  const bytes = await createInvoicePdf(pdfData);

  return new Response(Buffer.from(bytes), {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="${invoicePdfFileName(pdfData)}"`,
      'Content-Type': 'application/pdf',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
