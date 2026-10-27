import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610270004_phase6_follow_up_openai_review.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Follow-Up OpenAI review migration', () => {
  it('creates a private durable queue with bounded leases and attempts', () => {
    expect(migration).toContain('CREATE TABLE public.ai_provider_review_jobs');
    expect(migration).toContain(
      "status IN ('queued', 'processing', 'completed', 'failed')",
    );
    expect(migration).toContain('attempt_count BETWEEN 0 AND 5');
    expect(migration).toContain("interval '2 minutes'");
    expect(migration).toContain('FOR UPDATE OF job SKIP LOCKED');
    expect(migration).toContain('REVOKE ALL ON public.ai_provider_review_jobs');
  });

  it('queues only trusted deterministic Follow-Up runs', () => {
    expect(migration).toContain("NEW.agent_kind = 'follow_up'");
    expect(migration).toContain("NEW.policy_version = 'follow-up-v1'");
    expect(migration).toContain("NEW.provider = 'stub'");
    expect(migration).toContain("NEW.status = 'succeeded'");
  });

  it('bounds and records provider evidence without sending messages', () => {
    expect(migration).toContain("target_model <> 'gpt-6-luna'");
    expect(migration).toContain('target_input_tokens NOT BETWEEN 0 AND 4000');
    expect(migration).toContain('target_output_tokens NOT BETWEEN 0 AND 300');
    expect(migration).toContain("run.agent_kind = 'follow_up'");
    expect(migration).toContain('run.actor_user_id IS NULL');
    expect(migration).toContain("'ai.follow_up_provider_reviewed'");
    expect(migration).not.toMatch(
      /UPDATE\s+public\.follow_up_messages\s+SET\s+status\s*=\s*'delivered'/i,
    );
  });

  it('schedules the service-authenticated worker from existing Vault secrets', () => {
    expect(migration).toContain("'crewflow-review-follow-up-proposals'");
    expect(migration).toContain("'*/5 * * * *'");
    expect(migration).toContain(
      "'/functions/v1/process-follow-up-openai-reviews'",
    );
    expect(migration).toContain("name = 'crewflow_edge_function_service_key'");
  });
});
