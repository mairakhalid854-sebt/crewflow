import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610250004_phase6_dispatcher_orchestration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('phase 6 Dispatcher orchestration', () => {
  it('authorizes an active owner or office actor from the trusted job tenant', () => {
    expect(migration).toContain(
      'CREATE FUNCTION public.request_dispatcher_proposal',
    );
    expect(migration).toContain("membership.role IN ('owner', 'office')");
    expect(migration).toContain('membership.tenant_id = locked_job.tenant_id');
    expect(migration).toContain('active office membership required');
  });

  it('loads authoritative skill, ZIP, availability, time-off, and conflict data', () => {
    expect(migration).toContain('service.required_skills');
    expect(migration).toContain('customer.postal_code');
    expect(migration).toContain('public.staff_availability');
    expect(migration).toContain('public.staff_time_off');
    expect(migration).toContain(
      "conflict.status IN ('scheduled', 'in_progress')",
    );
  });

  it('enforces AI enablement and effective monthly budget', () => {
    expect(migration).toContain('settings.ai_operations_enabled');
    expect(migration).toContain('AI operations are disabled');
    expect(migration).toContain('least(tenant_budget::bigint, plan_budget)');
    expect(migration).toContain('AI monthly budget exhausted');
  });

  it('creates governed traces and human approvals without mutating jobs', () => {
    expect(migration).toContain('INSERT INTO public.ai_agent_runs');
    expect(migration).toContain('INSERT INTO public.ai_run_steps');
    expect(migration).toContain('INSERT INTO public.ai_approval_requests');
    expect(migration).toContain("'dispatcher.assign_technician'");
    expect(migration).not.toMatch(/UPDATE\s+public\.jobs/i);
  });

  it('makes request correlation idempotent and records escalations', () => {
    expect(migration).toContain('target_correlation_id');
    expect(migration).toContain('AI correlation payload conflict');
    expect(migration).toContain('Existing Dispatcher evaluation returned.');
    expect(migration).toContain("'ai.dispatcher_escalated'");
  });

  it('does not expose the command to anonymous clients', () => {
    expect(migration).toContain('FROM PUBLIC, anon');
    expect(migration).toContain('TO authenticated');
  });
});
