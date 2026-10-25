import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610250005_phase6_dispatcher_guarded_executor.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('phase 6 Dispatcher guarded executor', () => {
  it('requires an approved typed action and an active office actor', () => {
    expect(migration).toContain(
      'CREATE FUNCTION public.execute_approved_dispatcher_assignment',
    );
    expect(migration).toContain("approval.status <> 'approved'");
    expect(migration).toContain(
      "approval.action_kind <> 'dispatcher.assign_technician'",
    );
    expect(migration).toContain('public.current_user_has_tenant_role');
  });

  it('locks and revalidates the exact target state before mutation', () => {
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain(
      'locked_job.updated_at::text IS DISTINCT FROM approval.target_state_version',
    );
    expect(migration).toContain("'rejected_stale'");
  });

  it('rechecks subscription, skills, ZIP, availability, time off, and conflicts', () => {
    expect(migration).toContain("subscription.access_mode = 'full'");
    expect(migration).toContain('required_service_skills');
    expect(migration).toContain('profile.service_area_postal_codes');
    expect(migration).toContain('public.staff_availability');
    expect(migration).toContain('public.staff_time_off');
    expect(migration).toContain('public.jobs AS conflict');
  });

  it('mutates only the locked job after every guard succeeds', () => {
    const updateIndex = migration.indexOf('UPDATE public.jobs');
    const eligibilityIndex = migration.indexOf('IF NOT candidate_is_eligible');
    expect(updateIndex).toBeGreaterThan(eligibilityIndex);
    expect(migration).toContain(
      'SET assigned_membership_id = proposed_technician_id',
    );
  });

  it('records one idempotent outcome, trace step, and audit event', () => {
    expect(migration).toContain('approval.execution_status IS NOT NULL');
    expect(migration).toContain("'guarded_execution'");
    expect(migration).toContain("'ai.dispatcher_executed'");
    expect(migration).toContain("'ai.dispatcher_execution_rejected'");
  });

  it('denies anonymous execution', () => {
    expect(migration).toContain('FROM PUBLIC, anon');
    expect(migration).toContain('TO authenticated');
  });
});
