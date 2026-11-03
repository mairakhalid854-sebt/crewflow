import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610260006_phase6_ai_run_replay.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('phase 6 governed AI replay', () => {
  it('records immutable tenant-scoped replay provenance', () => {
    expect(migration).toContain('CREATE TABLE public.ai_run_replays');
    expect(migration).toContain('ai_run_replays_immutable');
    expect(migration).toContain('ai_run_replays_read_office');
    expect(migration).toContain(
      'REVOKE ALL ON public.ai_run_replays FROM anon, authenticated',
    );
    expect(migration).toContain('source_run_id <> replay_run_id');
  });

  it('requires an active owner or office actor in the source tenant', () => {
    expect(migration).toContain('CREATE FUNCTION public.replay_ai_agent_run');
    expect(migration).toContain("membership.status = 'active'");
    expect(migration).toContain("membership.role IN ('owner', 'office')");
    expect(migration).toContain('AI run not found or unavailable');
    expect(migration).toContain('pending run cannot be replayed');
  });

  it('re-enters supported proposal functions under current controls', () => {
    expect(migration).toContain('public.request_dispatcher_proposal');
    expect(migration).toContain('public.request_report_proposal');
    expect(migration).toContain('public.request_report_invoice_proposal');
    expect(migration).toContain('public.request_intake_quote_slot_proposal');
    expect(migration).not.toMatch(/execute_approved|decide_ai_approval/);
  });

  it('is idempotent for one source and requested correlation', () => {
    expect(migration).toContain('ai_run_replays_source_correlation_unique');
    expect(migration).toContain('Existing replay returned.');
  });

  it('audits replay without directly mutating business records', () => {
    expect(migration).toContain("'ai.run_replayed'");
    expect(migration).not.toMatch(
      /UPDATE public\.(jobs|invoices|quotes|customers)/,
    );
    expect(migration).not.toMatch(
      /INSERT INTO public\.(jobs|invoices|quotes|customers)/,
    );
  });
});
