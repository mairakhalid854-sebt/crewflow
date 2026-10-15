import { z } from 'zod';

const publicQuoteItemSchema = z.object({
  description: z.string(),
  line_total_cents: z.number().int().nonnegative(),
  quantity: z.number().int().positive(),
  taxable: z.boolean(),
  unit_price_cents: z.number().int().nonnegative(),
});

export const publicQuoteSchema = z.object({
  accepted_at: z.string().nullable(),
  company_name: z.string(),
  currency_code: z.literal('USD'),
  customer_name: z.string(),
  declined_at: z.string().nullable(),
  discount_cents: z.number().int().nonnegative(),
  expires_at: z.string(),
  items: z.array(publicQuoteItemSchema).min(1),
  job_title: z.string(),
  quote_id: z.uuid(),
  sent_at: z.string().nullable(),
  status: z.enum(['sent', 'accepted', 'declined', 'expired']),
  subtotal_cents: z.number().int().nonnegative(),
  tax_cents: z.number().int().nonnegative(),
  tax_rate_bps: z.number().int().nonnegative(),
  total_cents: z.number().int().nonnegative(),
});

export type PublicQuote = z.infer<typeof publicQuoteSchema>;

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    style: 'currency',
  }).format(cents / 100);
}
