import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610150003_quote_amount_bigints.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('quote amount bigint hardening migration', () => {
  it('stores calculated quote amounts as 64-bit cents', () => {
    expect(migration).toContain('ALTER COLUMN line_total_cents TYPE bigint');
    expect(migration).toContain('ALTER COLUMN subtotal_cents TYPE bigint');
    expect(migration).toContain('ALTER COLUMN total_cents TYPE bigint');
  });

  it('casts multiplication before calculating line totals', () => {
    expect(migration).toContain(
      'item_quantity::bigint * item_unit_price_cents::bigint',
    );
    expect(migration).toContain(
      'line_total_cents = quantity::bigint * unit_price_cents::bigint',
    );
  });
});
