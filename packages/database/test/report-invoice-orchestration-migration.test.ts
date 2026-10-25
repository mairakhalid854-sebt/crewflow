import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610250008_phase6_report_invoice_orchestration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('phase 6 Report invoice orchestration', () => {
  it('authorizes an active office actor from the trusted job tenant', () => {
    expect(migration).toContain(
      'CREATE FUNCTION public.request_report_invoice_proposal',
    );
    expect(migration).toContain("membership.role IN ('owner', 'office')");
    expect(migration).toContain('membership.tenant_id = locked_job.tenant_id');
  });

  it('prefers accepted quote lines and otherwise uses an enabled catalog service', () => {
    expect(migration).toContain("quote.status = 'accepted'");
    expect(migration).toContain('public.quote_line_items');
    expect(migration).toContain("source_kind := 'accepted_quote'");
    expect(migration).toContain('service.archived_at IS NULL');
    expect(migration).toContain('service.is_enabled');
    expect(migration).toContain("source_kind := 'catalog_service'");
  });

  it('prevents duplicate active invoices and enforces AI budget', () => {
    expect(migration).toContain("invoice.status <> 'void'");
    expect(migration).toContain('duplicate_prevention');
    expect(migration).toContain('settings.ai_operations_enabled');
    expect(migration).toContain('AI monthly budget exhausted');
  });

  it('creates evidence-versioned exact approvals without invoice mutation', () => {
    expect(migration).toContain('pricing_state_version');
    expect(migration).toContain('INSERT INTO public.ai_agent_runs');
    expect(migration).toContain('INSERT INTO public.ai_run_steps');
    expect(migration).toContain('INSERT INTO public.ai_approval_requests');
    expect(migration).toContain("'report.save_invoice_draft'");
    expect(migration).not.toMatch(
      /(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.invoices/i,
    );
    expect(migration).not.toMatch(
      /(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.invoice_line_items/i,
    );
  });

  it('never derives charges from field evidence or creates payment/customer side effects', () => {
    expect(migration).toContain(
      'Field notes, photos, parts, and recommendations were not converted into charges.',
    );
    expect(migration).not.toContain('public.job_work_notes');
    expect(migration).not.toContain('public.job_media');
    expect(migration).not.toContain('public.payment_records');
    expect(migration).not.toContain('public.publish_job_invoice');
  });

  it('is idempotent and denies anonymous invocation', () => {
    expect(migration).toContain('AI correlation payload conflict');
    expect(migration).toContain('Existing Report invoice evaluation returned.');
    expect(migration).toContain('FROM PUBLIC, anon');
    expect(migration).toContain('TO authenticated');
  });
});
