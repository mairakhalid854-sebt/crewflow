import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610250007_phase6_report_guarded_executor.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('phase 6 Report guarded executor', () => {
  it('requires an approved typed action and active office actor', () => {
    expect(migration).toContain(
      'CREATE FUNCTION public.execute_approved_report_draft',
    );
    expect(migration).toContain("approval.status <> 'approved'");
    expect(migration).toContain("approval.action_kind <> 'report.save_draft'");
    expect(migration).toContain('public.current_user_has_tenant_role');
  });

  it('locks and revalidates job, subscription, evidence, and exact prior values', () => {
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain("subscription.access_mode = 'full'");
    expect(migration).toContain(
      'current_state_version IS DISTINCT FROM approval.target_state_version',
    );
    expect(migration).toContain(
      "approval.proposed_changes #>> '{summary,from}'",
    );
    expect(migration).toContain("'rejected_stale'");
    expect(migration).toContain("'rejected_policy'");
  });

  it('validates bounded proposed fields before any report write', () => {
    const validationIndex = migration.indexOf(
      'Report proposal fields are invalid',
    );
    const insertIndex = migration.indexOf('INSERT INTO public.work_reports');
    expect(validationIndex).toBeGreaterThan(0);
    expect(insertIndex).toBeGreaterThan(validationIndex);
    expect(migration).toContain('BETWEEN 1 AND 10000');
  });

  it('only saves an editable report and never publishes or invoices', () => {
    expect(migration).toContain('INSERT INTO public.work_reports');
    expect(migration).toContain('UPDATE public.work_reports');
    expect(migration).not.toMatch(/INSERT INTO\s+public\.invoices/i);
    expect(migration).not.toContain('public.publish_job_work_report');
    expect(migration).not.toMatch(/SET\s+status\s*=\s*'sent'/i);
  });

  it('records an idempotent execution outcome, trace, and audit event', () => {
    expect(migration).toContain('approval.execution_status IS NOT NULL');
    expect(migration).toContain("'guarded_execution'");
    expect(migration).toContain("'ai.report_executed'");
    expect(migration).toContain("'ai.report_execution_rejected'");
  });

  it('denies anonymous execution', () => {
    expect(migration).toContain('FROM PUBLIC, anon');
    expect(migration).toContain('TO authenticated');
  });
});
