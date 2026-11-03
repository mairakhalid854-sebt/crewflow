import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610240002_phase6_ai_governance.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('phase 6 AI governance foundation', () => {
  it('keeps the first slice provider-neutral and free of live model access', () => {
    expect(migration).toContain("provider text NOT NULL DEFAULT 'stub'");
    expect(migration).toContain(
      "model text NOT NULL DEFAULT 'deterministic-v1'",
    );
    expect(migration).toContain('ai_agent_runs_stub_only');
    expect(migration).not.toMatch(/openai|anthropic|gemini|api[_ ]key/i);
  });

  it('stores redacted summaries instead of raw prompts and payloads', () => {
    expect(migration).toContain('redacted_input_summary text NOT NULL');
    expect(migration).toContain('redacted_summary text NOT NULL');
    expect(migration).not.toMatch(/raw_prompt|prompt_body|tool_payload/);
  });

  it('enforces tenant-scoped immutable traces', () => {
    expect(migration).toContain('ai_run_steps_run_tenant_fk');
    expect(migration).toContain('ai_run_steps_immutable');
    expect(migration).toContain('AI trace steps are immutable');
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain(
      'REVOKE ALL ON public.ai_run_steps FROM anon, authenticated',
    );
  });

  it('allows only active owner or office actors to start governed runs', () => {
    expect(migration).toContain('CREATE FUNCTION public.begin_stub_ai_run');
    expect(migration).toContain("auth.role() IS DISTINCT FROM 'service_role'");
    expect(migration).toContain("membership.role IN ('owner', 'office')");
    expect(migration).toContain('AI operations are disabled');
    expect(migration).toContain('AI monthly budget exhausted');
    expect(migration).toContain('AI correlation payload conflict');
  });

  it('caps approvals at 48 hours and makes decisions single-use', () => {
    expect(migration).toContain("now() + interval '48 hours'");
    expect(migration).toContain(
      "expires_at <= created_at + interval '48 hours'",
    );
    expect(migration).toContain("approval.status <> 'pending'");
    expect(migration).toContain('approval.expires_at <= now()');
    expect(migration).toContain('FOR UPDATE');
  });

  it('keeps agent approvals inspectable and human controlled', () => {
    expect(migration).toContain('proposed_changes jsonb NOT NULL');
    expect(migration).toContain('consequences text NOT NULL');
    expect(migration).toContain('target_state_version text');
    expect(migration).toContain('CREATE FUNCTION public.decide_ai_approval');
    expect(migration).toContain("'ai.approval_' || final_status::text");
  });
});
