import { describe, expect, it } from 'vitest';

import {
  formatInvoiceNumber,
  normalizeExternalPaymentUrl,
  publicInvoiceSchema,
} from './public-invoice';

describe('invoice helpers', () => {
  it('formats tenant invoice sequence numbers consistently', () => {
    expect(formatInvoiceNumber(42)).toBe('INV-000042');
  });

  it('allows only credential-free HTTPS URLs on public domain names', () => {
    expect(normalizeExternalPaymentUrl('https://pay.example.com/i/123')).toBe(
      'https://pay.example.com/i/123',
    );
    expect(normalizeExternalPaymentUrl('http://pay.example.com')).toBeNull();
    expect(normalizeExternalPaymentUrl('https://localhost/pay')).toBeNull();
    expect(
      normalizeExternalPaymentUrl('https://user:pass@pay.example.com'),
    ).toBeNull();
  });

  it('validates the intentionally public invoice projection', () => {
    expect(
      publicInvoiceSchema.safeParse({
        company_name: 'CrewFlow HVAC',
        company_time_zone: 'America/Los_Angeles',
        currency_code: 'USD',
        customer_name: 'Alex Morgan',
        discount_cents: 0,
        due_at: '2026-11-01T23:59:00Z',
        invoice_id: '550e8400-e29b-41d4-a716-446655440000',
        invoice_number: 7,
        items: [
          {
            description: 'Repair',
            line_total_cents: 12_500,
            quantity: 1,
            taxable: true,
            unit_price_cents: 12_500,
          },
        ],
        job_title: 'Repair visit',
        outstanding_cents: 12_500,
        paid_cents: 0,
        payment_url: 'https://pay.example.com/i/7',
        sent_at: '2026-10-15T18:00:00Z',
        status: 'sent',
        subtotal_cents: 12_500,
        tax_cents: 0,
        total_cents: 12_500,
        void_reason: null,
      }).success,
    ).toBe(true);
  });
});
