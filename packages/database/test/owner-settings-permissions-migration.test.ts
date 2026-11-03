import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610130001_owner_only_company_settings.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Owner-only company settings migration', () => {
  it('removes the office business-hours write policy', () => {
    expect(migration).toContain(
      'DROP POLICY business_hours_manage_office ON public.business_hours;',
    );
  });

  it('allows only active owners to mutate business hours', () => {
    expect(migration).toContain(
      'CREATE POLICY business_hours_manage_owner ON public.business_hours',
    );
    expect(migration).toContain("ARRAY['owner']::public.membership_role[]");
    expect(migration).not.toMatch(/ARRAY\[[^\]]*'office'/);
  });
});
