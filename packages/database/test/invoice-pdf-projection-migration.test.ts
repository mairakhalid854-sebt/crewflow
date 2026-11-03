import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610150007_invoice_pdf_projection.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('invoice PDF public projection migration', () => {
  it('adds the business time zone without broadening token access', () => {
    expect(migration).toContain("'company_time_zone', tenant.time_zone");
    expect(migration).toContain("invoice_token ~ '^[0-9a-f]{64}$'");
    expect(migration).toContain(
      "extensions.digest(pg_catalog.convert_to(invoice_token, 'UTF8'), 'sha256')",
    );
    expect(migration).toContain(
      "invoice.status IN ('sent', 'partially_paid', 'paid', 'void')",
    );
  });

  it('keeps the function as a narrow token RPC', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.get_public_invoice(text) FROM PUBLIC',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_public_invoice(text) TO anon, authenticated',
    );
  });
});
