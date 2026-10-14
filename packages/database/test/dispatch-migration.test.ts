import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610140002_dispatch_controls.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Phase 2 dispatch controls migration', () => {
  it('adds tenant-safe, audited technician time off', () => {
    expect(migration).toContain('CREATE TABLE public.staff_time_off');
    expect(migration).toContain('staff_time_off_membership_tenant_fk');
    expect(migration).toContain('staff_time_off_record_activity');
    expect(migration).toContain('staff_time_off_no_overlap');
  });

  it('enforces weekly availability in the business time zone', () => {
    expect(migration).toContain('AT TIME ZONE tenant_time_zone');
    expect(migration).toContain(
      'availability.day_of_week = extract(dow FROM local_start)',
    );
    expect(migration).toContain('availability.starts_at <= local_start::time');
    expect(migration).toContain('availability.ends_at >= local_end::time');
  });

  it('rejects time-off collisions and missing service skills', () => {
    expect(migration).toContain('job schedule overlaps technician time off');
    expect(migration).toContain(
      'technician does not have all required service skills',
    );
    expect(migration).toContain(
      'lower(trim(staff_skill)) = lower(trim(required_skill))',
    );
  });

  it('keeps time-off writes limited to office roles', () => {
    expect(migration).toContain('staff_time_off_manage_office');
    expect(migration).toContain(
      "ARRAY['owner', 'office']::public.membership_role[]",
    );
    expect(migration).toContain(
      'REVOKE ALL ON public.staff_time_off FROM anon, authenticated',
    );
  });
});
