import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610150005_invoice_reason_constraints.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('invoice reason constraint hardening', () => {
  it('explicitly rejects null void and adjustment reasons', () => {
    expect(migration).toContain('void_reason IS NOT NULL');
    expect(migration).toContain("record_type <> 'adjustment'");
    expect(migration).toContain('note IS NOT NULL');
  });
});
