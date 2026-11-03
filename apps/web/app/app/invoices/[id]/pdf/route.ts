import {
  createInvoicePdf,
  invoicePdfFileName,
} from '../../../../../lib/invoices/invoice-pdf';
import { requireTenantContext } from '../../../../../lib/auth/tenant-context';
import { createClient } from '../../../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const context = await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', context.tenantId)
    .maybeSingle();
  if (invoiceError) throw new Error('Invoice could not be loaded.');
  if (!invoice) return new Response(null, { status: 404 });

  const [customerResult, jobResult, linesResult] = await Promise.all([
    supabase
      .from('customers')
      .select('first_name, last_name')
      .eq('id', invoice.customer_id)
      .eq('tenant_id', context.tenantId)
      .single(),
    supabase
      .from('jobs')
      .select('title')
      .eq('id', invoice.job_id)
      .eq('tenant_id', context.tenantId)
      .single(),
    supabase
      .from('invoice_line_items')
      .select('*')
      .eq('invoice_id', invoice.id)
      .eq('tenant_id', context.tenantId)
      .order('position'),
  ]);
  if (customerResult.error || jobResult.error || linesResult.error) {
    throw new Error('Invoice PDF details could not be loaded.');
  }

  const pdfData = {
    companyName: context.tenantName,
    customerName: `${customerResult.data.first_name} ${customerResult.data.last_name}`,
    discountCents: invoice.discount_cents,
    dueAt: invoice.due_at,
    invoiceNumber: invoice.invoice_number,
    items: (linesResult.data ?? []).map((item) => ({
      description: item.description,
      lineTotalCents: item.line_total_cents,
      quantity: item.quantity,
      taxable: item.taxable,
      unitPriceCents: item.unit_price_cents,
    })),
    jobTitle: jobResult.data.title,
    outstandingCents: invoice.total_cents - invoice.paid_cents,
    paidCents: invoice.paid_cents,
    status: invoice.status,
    subtotalCents: invoice.subtotal_cents,
    taxCents: invoice.tax_cents,
    timeZone: context.timeZone,
    totalCents: invoice.total_cents,
    voidReason: invoice.status === 'void' ? invoice.void_reason : null,
  } as const;
  const bytes = await createInvoicePdf(pdfData);

  return new Response(Buffer.from(bytes), {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="${invoicePdfFileName(pdfData)}"`,
      'Content-Type': 'application/pdf',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
