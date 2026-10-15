import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610150001_job_service_area_validation.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Phase 2 job service-area migration', () => {
  it('validates assignments against same-tenant active technician profiles', () => {
    expect(migration).toContain(
      'CREATE FUNCTION public.validate_job_service_area',
    );
    expect(migration).toContain("membership.role = 'technician'");
    expect(migration).toContain("membership.status = 'active'");
    expect(migration).toContain('membership.tenant_id = NEW.tenant_id');
    expect(migration).toContain('customer.tenant_id = NEW.tenant_id');
  });

  it('allows an empty coverage list and supports five-digit ZIP prefixes', () => {
    expect(migration).toContain(
      "cardinality(coalesce(technician_service_areas, '{}')) = 0",
    );
    expect(migration).toContain(
      'left(customer_postal_code, 5) = trim(service_area.postal_code)',
    );
  });

  it('rejects missing and uncovered customer postal codes', () => {
    expect(migration).toContain(
      'customer postal code is required to validate technician service area',
    );
    expect(migration).toContain(
      'technician service area does not cover the customer postal code',
    );
    expect(migration).toContain("USING ERRCODE = '22023'");
  });

  it('checks only new or changed job assignments', () => {
    expect(migration).toContain(
      'NEW.assigned_membership_id IS NOT DISTINCT FROM OLD.assigned_membership_id',
    );
    expect(migration).toContain(
      'NEW.customer_id IS NOT DISTINCT FROM OLD.customer_id',
    );
    expect(migration).toContain('CREATE TRIGGER jobs_validate_service_area');
  });
});
