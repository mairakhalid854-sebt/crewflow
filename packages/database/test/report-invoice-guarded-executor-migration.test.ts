import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610250009_phase6_report_invoice_guarded_executor.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('phase 6 Report invoice guarded executor', () => {
  it('requires an approved typed action and active office actor', () => {
    expect(migration).toContain(
      'CREATE FUNCTION public.execute_approved_report_invoice_draft',
    );
    expect(migration).toContain("approval.status <> 'approved'");
    expect(migration).toContain(
      "approval.action_kind <> 'report.save_invoice_draft'",
    );
    expect(migration).toContain('public.current_user_has_tenant_role');
  });

  it('re-derives the trusted quote or catalog pricing under lock', () => {
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain("quote.status = 'accepted'");
    expect(migration).toContain('public.quote_line_items');
    expect(migration).toContain('service.is_enabled');
    expect(migration).toContain(
      'current_state_version IS DISTINCT FROM approval.target_state_version',
    );
  });

  it('revalidates subscription, exact values, due date, and duplicate state', () => {
    expect(migration).toContain("subscription.access_mode = 'full'");
    expect(migration).toContain("invoice.status <> 'void'");
    expect(migration).toContain(
      "approval.proposed_changes #> '{lineItems,to}'",
    );
    expect(migration).toContain(
      "approval.proposed_changes #>> '{totalCents,to}'",
    );
    expect(migration).toContain("approval.proposed_changes #>> '{dueAt,to}'");
    expect(migration).toContain("'rejected_stale'");
    expect(migration).toContain("'rejected_policy'");
  });

  it('saves only an editable draft without publication, payment, or communication', () => {
    expect(migration).toContain('public.save_job_invoice');
    expect(migration).not.toContain('public.publish_job_invoice');
    expect(migration).not.toContain('public.payment_records');
    expect(migration).not.toMatch(/SET\s+status\s*=\s*'sent'/i);
    expect(migration).not.toContain('email');
  });

  it('records idempotent outcomes, trace, audit, and denies anonymous use', () => {
    expect(migration).toContain('approval.execution_status IS NOT NULL');
    expect(migration).toContain("'guarded_execution'");
    expect(migration).toContain("'ai.report_invoice_executed'");
    expect(migration).toContain("'ai.report_invoice_execution_rejected'");
    expect(migration).toContain('FROM PUBLIC, anon');
    expect(migration).toContain('TO authenticated');
  });
});
