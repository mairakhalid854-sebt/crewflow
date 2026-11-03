import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610150002_phase3_quotes.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Phase 3 quotes migration', () => {
  it('binds quote, job, customer, and line items to one tenant', () => {
    expect(migration).toContain('jobs_id_tenant_unique');
    expect(migration).toContain('quotes_job_tenant_fk');
    expect(migration).toContain('quotes_customer_tenant_fk');
    expect(migration).toContain('quote_line_items_quote_tenant_fk');
    expect(migration).toContain('FOREIGN KEY (quote_id, tenant_id)');
  });

  it('calculates snapshot totals inside an authorized transaction', () => {
    expect(migration).toContain('CREATE FUNCTION public.save_job_quote');
    expect(migration).toContain(
      "ARRAY['owner', 'office']::public.membership_role[]",
    );
    expect(migration).toContain('quote_discount_cents > quote_subtotal');
    expect(migration).toContain('quote_taxable_discount');
    expect(migration).toContain(
      'total_cents = subtotal_cents - discount_cents + tax_cents',
    );
  });

  it('stores only a SHA-256 token hash and scopes public reads to it', () => {
    expect(migration).toContain('extensions.gen_random_bytes(32)');
    expect(migration).toContain(
      "extensions.digest(pg_catalog.convert_to(generated_token, 'UTF8'), 'sha256')",
    );
    expect(migration).toContain('CREATE FUNCTION public.get_public_quote');
    expect(migration).toContain("quote_token ~ '^[0-9a-f]{64}$'");
    expect(migration).toContain(
      'REVOKE ALL ON public.quotes, public.quote_line_items FROM anon',
    );
  });

  it('allows a single unexpired decision and advances accepted jobs', () => {
    expect(migration).toContain('CREATE FUNCTION public.decide_public_quote');
    expect(migration).toContain("quote.status = 'sent'");
    expect(migration).toContain("SET status = 'accepted'");
    expect(migration).toContain("status = 'quoted'");
    expect(migration).toContain('quote is unavailable or already decided');
  });

  it('audits saved, sent, accepted, and declined quote events', () => {
    expect(migration).toContain("'quote.saved'");
    expect(migration).toContain("'quote.sent'");
    expect(migration).toContain("'quote.' || quote_decision");
    expect(migration).toContain("'customer_token_action', true");
  });
});
