import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610150004_phase3_invoices.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Phase 3 invoices migration', () => {
  it('creates tenant-bound invoice snapshots and append-only payments', () => {
    expect(migration).toContain('CREATE TABLE public.invoices');
    expect(migration).toContain('invoices_job_tenant_fk');
    expect(migration).toContain('invoice_line_items_invoice_tenant_fk');
    expect(migration).toContain('payment_records_invoice_tenant_fk');
    expect(migration).toContain('invoices_one_active_per_job_idx');
  });

  it('allocates race-safe tenant invoice numbers', () => {
    expect(migration).toContain('CREATE TABLE public.invoice_number_counters');
    expect(migration).toContain('ON CONFLICT (tenant_id) DO UPDATE');
    expect(migration).toContain(
      'next_number - 1 INTO generated_invoice_number',
    );
    expect(migration).toContain('invoices_number_tenant_unique');
  });

  it('accepts only business-owned HTTPS links without treating clicks as payment', () => {
    expect(migration).toContain('is_allowed_external_payment_url');
    expect(migration).toContain("candidate ~ '^https://");
    expect(migration).toContain('CREATE FUNCTION public.get_public_invoice');
    expect(migration).toContain(
      "'outstanding_cents', invoice.total_cents - invoice.paid_cents",
    );
  });

  it('records partial manual payments and owner-only adjustments transactionally', () => {
    expect(migration).toContain(
      'CREATE FUNCTION public.record_manual_invoice_payment',
    );
    expect(migration).toContain("'partially_paid'::public.invoice_status");
    expect(migration).toContain("'source', 'manual'");
    expect(migration).toContain(
      'CREATE FUNCTION public.record_invoice_adjustment',
    );
    expect(migration).toContain("ARRAY['owner']::public.membership_role[]");
  });

  it('preserves voided invoice history and denies direct mutations', () => {
    expect(migration).toContain('CREATE FUNCTION public.void_invoice');
    expect(migration).toContain("status = 'void'");
    expect(migration).toContain('invoice void reason is required');
    expect(migration).toContain(
      'REVOKE ALL ON public.invoice_number_counters, public.invoices,',
    );
  });
});
