import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610120003_phase1_company_settings.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Phase 1 company settings migration', () => {
  it('derives the tenant from an active owner membership', () => {
    expect(migration).toContain('membership.user_id = current_user_id');
    expect(migration).toContain("membership.role = 'owner'");
    expect(migration).toContain("membership.status = 'active'");
    expect(migration).not.toMatch(/target_tenant_id uuid[,)\n]/);
  });

  it('validates and updates exactly seven business-hour records', () => {
    expect(migration).toContain(
      'pg_catalog.jsonb_array_length(input_weekly_hours) <> 7',
    );
    expect(migration).toContain(
      'ON CONFLICT (tenant_id, day_of_week) DO UPDATE',
    );
    expect(migration).toContain("GROUP BY hours_item ->> 'dayOfWeek'");
  });

  it('keeps all company updates inside one database function', () => {
    expect(migration).toContain('UPDATE public.tenants');
    expect(migration).toContain('UPDATE public.tenant_settings');
    expect(migration).toContain('INSERT INTO public.business_hours');
  });

  it('records an audit event and exposes only the RPC to authenticated users', () => {
    expect(migration).toContain("'tenant.settings_updated'");
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.update_company_settings',
    );
    expect(migration).toContain('TO authenticated;');
  });
});
