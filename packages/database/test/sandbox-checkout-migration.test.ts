import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610210002_phase5_sandbox_checkout.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Paddle sandbox checkout catalog boundary', () => {
  it('exposes only active development sandbox plans to owners', () => {
    expect(migration).toContain(
      'CREATE FUNCTION public.list_owner_paddle_sandbox_plans()',
    );
    expect(migration).toContain("membership.role = 'owner'");
    expect(migration).toContain("plan.provider = 'paddle_sandbox'");
    expect(migration).toContain('plan.is_development_only');
    expect(migration).not.toContain('paddle_live');
  });

  it('keeps direct plan table access revoked', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.list_owner_paddle_sandbox_plans() FROM PUBLIC',
    );
    expect(migration).toContain('TO authenticated');
  });
});
