import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610210003_phase5_sandbox_catalog.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Paddle sandbox catalog', () => {
  it.each([
    ['starter_monthly_sandbox', 2900, 3],
    ['growth_monthly_sandbox', 7900, 10],
    ['pro_monthly_sandbox', 14900, 30],
  ])(
    'seeds %s at the approved monthly price and seat limit',
    (code, amount, seats) => {
      expect(migration).toContain(`'${code}'`);
      expect(migration).toMatch(
        new RegExp(
          `'${code}'[^\\n]+${amount}[^\\n]+${seats}[^\\n]+14, true, true`,
        ),
      );
    },
  );

  it('uses only sandbox price identifiers and keeps the seed idempotent', () => {
    expect(migration.match(/pri_[a-z0-9]+/g)).toHaveLength(3);
    expect(migration).toContain("'paddle_sandbox'");
    expect(migration).toContain('ON CONFLICT (code) DO UPDATE SET');
    expect(migration).not.toContain('paddle_live');
  });
});
