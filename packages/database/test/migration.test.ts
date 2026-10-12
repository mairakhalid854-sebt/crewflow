import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610120001_phase1_identity_tenancy.sql',
    import.meta.url,
  ),
  'utf8',
);

const tenantTables = [
  'tenants',
  'memberships',
  'tenant_settings',
  'business_hours',
  'services',
  'customers',
  'audit_events',
] as const;

describe('Phase 1 tenant migration', () => {
  it.each(tenantTables)('enables RLS for %s', (table) => {
    expect(migration).toContain(
      `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`,
    );
  });

  it.each(tenantTables.filter((table) => table !== 'tenants'))(
    'declares tenant_id on %s',
    (table) => {
      const tableDefinition = migration.match(
        new RegExp(`CREATE TABLE public\\.${table} \\(([\\s\\S]*?)\\n\\);`),
      )?.[1];
      expect(tableDefinition).toContain('tenant_id uuid NOT NULL');
    },
  );

  it('does not grant tenant tables to anonymous users', () => {
    expect(migration).toContain(
      'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;',
    );
    expect(migration).not.toMatch(/GRANT .+ ON public\..+ TO anon;/);
  });

  it('enforces one active tenant membership per user', () => {
    expect(migration).toContain('memberships_one_active_tenant_per_user');
    expect(migration).toContain("WHERE status = 'active'");
  });

  it('does not permit direct audit event writes from authenticated clients', () => {
    expect(migration).toContain(
      'GRANT SELECT ON public.audit_events TO authenticated;',
    );
    expect(migration).not.toMatch(
      /GRANT .*INSERT.* ON public\.audit_events TO authenticated;/,
    );
  });
});
