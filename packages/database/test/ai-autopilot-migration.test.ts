import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202611090001_ai_autopilot.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('AI Autopilot migration', () => {
  it('keeps every policy off by default and owner-controlled', () => {
    expect(migration).toContain('CREATE TABLE public.ai_autopilot_policies');
    expect(migration).toContain('enabled boolean NOT NULL DEFAULT false');
    expect(migration).toContain("ARRAY['owner']::public.membership_role[]");
    expect(migration).toContain("'ai.autopilot_enabled'");
    expect(migration).toContain("'ai.autopilot_disabled'");
  });

  it('never automates reassignment of work already assigned', () => {
    expect(migration).toContain("'{assignedMembershipId,from}' IS NULL");
    expect(migration).toContain("'dispatcher.assign_new'");
  });

  it('reuses the existing guarded executors instead of writing directly', () => {
    for (const executor of [
      'execute_approved_follow_up_message',
      'execute_approved_dispatcher_assignment',
      'execute_approved_report_draft',
      'execute_approved_report_invoice_draft',
      'execute_approved_intake_draft_records',
    ]) {
      expect(migration).toContain(`public.${executor}(candidate.id)`);
    }
    expect(migration).toContain('public.decide_ai_approval(');
    expect(migration).not.toContain('UPDATE public.jobs');
    expect(migration).not.toContain('UPDATE public.invoices');
  });

  it('respects AI enablement, active owners, and records every outcome', () => {
    expect(migration).toContain('settings.ai_operations_enabled');
    expect(migration).toContain("membership.role = 'owner'");
    expect(migration).toContain("'skipped_inactive_owner'");
    expect(migration).toContain('EXCEPTION WHEN OTHERS THEN');
    expect(migration).toContain('FOR UPDATE OF approval SKIP LOCKED');
  });

  it('keeps the worker service-only and browser tables read-only', () => {
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.run_ai_autopilot(integer) TO service_role',
    );
    expect(migration).toContain(
      'REVOKE ALL ON public.ai_autopilot_policies FROM PUBLIC, anon, authenticated',
    );
    expect(migration).toContain(
      'GRANT SELECT ON public.ai_autopilot_policies TO authenticated',
    );
    expect(migration).toContain("'crewflow-ai-autopilot'");
  });
});
