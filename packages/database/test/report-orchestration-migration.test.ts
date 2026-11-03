import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610250006_phase6_report_orchestration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('phase 6 Report orchestration', () => {
  it('authorizes active office actors through the trusted job tenant', () => {
    expect(migration).toContain(
      'CREATE FUNCTION public.request_report_proposal',
    );
    expect(migration).toContain("membership.role IN ('owner', 'office')");
    expect(migration).toContain('membership.tenant_id = locked_job.tenant_id');
    expect(migration).toContain('active office membership required');
  });

  it('requires completed work and authoritative tenant-bound evidence', () => {
    expect(migration).toContain(
      "locked_job.status NOT IN ('completed', 'closed')",
    );
    expect(migration).toContain('public.job_work_notes');
    expect(migration).toContain('public.job_media');
    expect(migration).toContain('media.uploaded_at IS NOT NULL');
    expect(migration).toContain('public.job_signatures');
    expect(migration).toContain('note.tenant_id = locked_job.tenant_id');
  });

  it('marks unsupported facts unknown and does not interpret media', () => {
    expect(migration).toContain(
      'Unknown - no structured parts-used record was supplied.',
    );
    expect(migration).toContain(
      'Unknown - no structured technician recommendation was supplied.',
    );
    expect(migration).toContain('Image contents were not interpreted.');
  });

  it('enforces AI enablement, budget, idempotency, and evidence versioning', () => {
    expect(migration).toContain('settings.ai_operations_enabled');
    expect(migration).toContain('AI monthly budget exhausted');
    expect(migration).toContain('AI correlation payload conflict');
    expect(migration).toContain('evidence_state_version');
    expect(migration).toContain(
      'approval.target_state_version = evidence_state_version',
    );
  });

  it('creates governed traces and approval without writing reports or invoices', () => {
    expect(migration).toContain('INSERT INTO public.ai_agent_runs');
    expect(migration).toContain('INSERT INTO public.ai_run_steps');
    expect(migration).toContain('INSERT INTO public.ai_approval_requests');
    expect(migration).toContain("'report.save_draft'");
    expect(migration).not.toMatch(
      /(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.work_reports/i,
    );
    expect(migration).not.toMatch(
      /(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.invoices/i,
    );
  });

  it('escalates missing and oversized evidence instead of fabricating facts', () => {
    expect(migration).toContain('technician_note_count = 0');
    expect(migration).toContain('char_length(report_work_performed) > 10000');
    expect(migration).toContain("'ai.report_escalated'");
  });

  it('does not expose the command to anonymous clients', () => {
    expect(migration).toContain('FROM PUBLIC, anon');
    expect(migration).toContain('TO authenticated');
  });
});
