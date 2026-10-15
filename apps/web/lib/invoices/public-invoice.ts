import { z } from 'zod';

const publicInvoiceItemSchema = z.object({
  description: z.string(),
  line_total_cents: z.number().int().nonnegative(),
  quantity: z.number().int().positive(),
  taxable: z.boolean(),
  unit_price_cents: z.number().int().nonnegative(),
});

export const publicInvoiceSchema = z.object({
  company_name: z.string(),
  currency_code: z.literal('USD'),
  customer_name: z.string(),
  discount_cents: z.number().int().nonnegative(),
  due_at: z.string(),
  invoice_id: z.uuid(),
  invoice_number: z.number().int().positive(),
  items: z.array(publicInvoiceItemSchema).min(1),
  job_title: z.string(),
  outstanding_cents: z.number().int().nonnegative(),
  paid_cents: z.number().int().nonnegative(),
  payment_url: z.url().nullable(),
  sent_at: z.string().nullable(),
  status: z.enum(['sent', 'partially_paid', 'paid', 'void']),
  subtotal_cents: z.number().int().nonnegative(),
  tax_cents: z.number().int().nonnegative(),
  total_cents: z.number().int().nonnegative(),
  void_reason: z.string().nullable(),
});

export type PublicInvoice = z.infer<typeof publicInvoiceSchema>;

export function formatInvoiceNumber(value: number): string {
  return `INV-${String(value).padStart(6, '0')}`;
}

export function normalizeExternalPaymentUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    const publicDomain =
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !publicDomain.test(url.hostname)
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}
