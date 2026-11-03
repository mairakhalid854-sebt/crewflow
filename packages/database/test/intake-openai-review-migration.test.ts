import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610270002_phase6_intake_openai_review.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Intake OpenAI review migration', () => {
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

  it('binds the review to the authenticated actor and trusted Intake run', () => {
    expect(migration).toContain('run.actor_user_id = target_user_id');
    expect(migration).toContain("run.agent_kind = 'intake'");
    expect(migration).toContain("run.policy_version = 'intake-quote-slots-v1'");
    expect(migration).toContain("run.status IN ('succeeded', 'escalated')");
    expect(migration).toContain('FOR UPDATE');
  });

  it('records evidence without creating customer, job, quote, or booking rows', () => {
    expect(migration).toContain('INSERT INTO public.ai_run_steps');
    expect(migration).toContain("'provider_reviewed'");
    expect(migration).toContain("'ai.intake_provider_reviewed'");
    expect(migration).not.toMatch(
      /(?:INSERT|UPDATE)\s+(?:INTO\s+)?public\.(?:customers|jobs|quotes)/i,
    );
  });

  it('exposes the recorder to service role only', () => {
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('TO service_role');
  });
});
