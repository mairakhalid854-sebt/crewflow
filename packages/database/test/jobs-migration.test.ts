import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610140001_phase2_jobs_workflow.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Phase 2 jobs workflow migration', () => {
  it('binds customer, service, and assignee references to the same tenant', () => {
    expect(migration).toContain('jobs_customer_tenant_fk');
    expect(migration).toContain('jobs_service_tenant_fk');
    expect(migration).toContain('jobs_assignee_tenant_fk');
    expect(migration).toContain('FOREIGN KEY (customer_id, tenant_id)');
  });

  it('enforces the explicit workflow in the database', () => {
    expect(migration).toContain('invalid job status transition');
    expect(migration).toContain(
      "OLD.status = 'accepted' AND NEW.status IN ('scheduled', 'cancelled')",
    );
    expect(migration).toContain(
      "OLD.status = 'completed' AND NEW.status = 'closed'",
    );
  });

  it('prevents concurrent technician schedule overlaps', () => {
    expect(migration).toContain('CREATE EXTENSION IF NOT EXISTS btree_gist');
    expect(migration).toContain('jobs_no_technician_overlap');
    expect(migration).toContain(
      "tstzrange(scheduled_start_at, scheduled_end_at, '[)') WITH &&",
    );
  });

  it('limits technicians to their assigned jobs and records activity', () => {
    expect(migration).toContain('membership.id = jobs.assigned_membership_id');
    expect(migration).toContain("membership.role = 'technician'");
    expect(migration).toContain('job.status_changed');
    expect(migration).toContain('job.scheduled');
  });
});
