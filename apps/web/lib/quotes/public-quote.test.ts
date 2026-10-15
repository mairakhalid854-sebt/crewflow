import { describe, expect, it } from 'vitest';

import { formatUsd, publicQuoteSchema } from './public-quote';

const validQuote = {
  accepted_at: null,
  company_name: 'CrewFlow HVAC',
  currency_code: 'USD',
  customer_name: 'Alex Morgan',
  declined_at: null,
  discount_cents: 500,
  expires_at: '2026-10-30T23:59:00.000Z',
  items: [
    {
      description: 'Seasonal inspection',
      line_total_cents: 12_500,
      quantity: 1,
      taxable: true,
      unit_price_cents: 12_500,
    },
  ],
  job_title: 'Fall HVAC inspection',
  quote_id: '550e8400-e29b-41d4-a716-446655440000',
  sent_at: '2026-10-15T18:00:00.000Z',
  status: 'sent',
  subtotal_cents: 12_500,
  tax_cents: 990,
  tax_rate_bps: 825,
  total_cents: 12_990,
};

describe('public quote data', () => {
  it('accepts the intentionally public quote projection', () => {
    expect(publicQuoteSchema.parse(validQuote)).toMatchObject({
      customer_name: 'Alex Morgan',
      status: 'sent',
      total_cents: 12_990,
    });
  });

  it('rejects unsupported currency, status, and empty line items', () => {
    expect(
      publicQuoteSchema.safeParse({
        ...validQuote,
        currency_code: 'EUR',
        items: [],
        status: 'draft',
      }).success,
    ).toBe(false);
  });

  it('formats integer cents as USD', () => {
    expect(formatUsd(12_990)).toBe('$129.90');
  });
});
