import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202611170001_live_plan_prices_2026_11.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Live plan prices 2026-11 migration', () => {
  it('sets the owner-approved monthly amounts on the existing live prices', () => {
    for (const row of [
      "('starter_monthly', 'pri_01m6k8spcay1tgqctewmv8jhwh', 4900::bigint)",
      "('growth_monthly', 'pri_01m6k8vg3stm76898n4673n648', 11900::bigint)",
      "('pro_monthly', 'pri_01m6k8x4a6ehvnyex8bqtgs2ts', 19900::bigint)",
    ]) {
      expect(migration).toContain(row);
    }
  });

  it('only touches live Paddle rows with matching price IDs', () => {
    expect(migration).toContain("AND plan.provider = 'paddle'");
    expect(migration).toContain(
      'AND plan.provider_price_id = new_price.provider_price_id',
    );
  });
});
