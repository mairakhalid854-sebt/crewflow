import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610270001_phase6_dispatcher_openai_review.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Dispatcher OpenAI review migration', () => {
  it('allows only the evaluated provider/model pair alongside the stub', () => {
    expect(migration).toContain('ai_agent_runs_provider_model_pair');
    expect(migration).toContain(
      "provider = 'stub' AND model = 'deterministic-v1'",
    );
    expect(migration).toContain("provider = 'openai' AND model = 'gpt-6-luna'");
  });

  it('bounds model usage, latency, cost, and redacted summary length', () => {
    expect(migration).toContain('target_input_tokens NOT BETWEEN 0 AND 4000');
    expect(migration).toContain('target_output_tokens NOT BETWEEN 0 AND 300');
    expect(migration).toContain(
      'target_estimated_cost_cents NOT BETWEEN 0 AND 2',
    );
    expect(migration).toContain('target_duration_ms NOT BETWEEN 0 AND 30000');
    expect(migration).toContain(
      'char_length(target_redacted_summary) NOT BETWEEN 1 AND 1000',
    );
  });

  it('binds the review to the authenticated actor and trusted Dispatcher run', () => {
    expect(migration).toContain('run.actor_user_id = target_user_id');
    expect(migration).toContain("run.agent_kind = 'dispatcher'");
    expect(migration).toContain("run.policy_version = 'dispatcher-v1'");
    expect(migration).toContain("run.status IN ('succeeded', 'escalated')");
    expect(migration).toContain('FOR UPDATE');
  });

  it('records an immutable step and audit event but never mutates a job', () => {
    expect(migration).toContain('INSERT INTO public.ai_run_steps');
    expect(migration).toContain("'provider_reviewed'");
    expect(migration).toContain("'ai.dispatcher_provider_reviewed'");
    expect(migration).not.toMatch(/UPDATE\s+public\.jobs/i);
  });

  it('exposes the recorder to service role only', () => {
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('TO service_role');
  });
});
