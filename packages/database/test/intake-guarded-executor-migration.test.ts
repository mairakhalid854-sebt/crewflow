import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  fileURLToPath(
    new URL(
      '../../../supabase/migrations/202610260002_phase6_intake_guarded_executor.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

describe('Intake guarded executor migration', () => {
  it('provides one idempotent conversion per conversation and approval', () => {
    expect(migration).toContain('CREATE TABLE public.intake_draft_conversions');
    expect(migration).toContain('UNIQUE (conversation_id)');
    expect(migration).toContain('UNIQUE (approval_id)');
    expect(migration).toContain(
      'CREATE FUNCTION public.execute_approved_intake_draft_records',
    );
    expect(migration).toContain('approval.execution_status IS NOT NULL');
  });

  it('requires an approved exact Intake action and full access', () => {
    expect(migration).toContain(
      "approval.action_kind <> 'intake.create_draft_records'",
    );
    expect(migration).toContain("approval.status <> 'approved'");
    expect(migration).toContain("'full'::public.billing_access_mode");
    expect(migration).toContain(
      'approval.proposed_changes IS DISTINCT FROM expected_changes',
    );
    expect(migration).toContain(
      'approval.target_state_version IS DISTINCT FROM expected_state_version',
    );
  });

  it('revalidates both slot options without booking either one', () => {
    expect(migration).toContain('jsonb_array_length(proposed_slots) <> 2');
    expect(migration).toContain('public.staff_availability');
    expect(migration).toContain('public.staff_time_off');
    expect(migration).toContain(
      "conflict.status IN ('scheduled', 'in_progress')",
    );
    expect(migration).toContain('valid_slot_count <> 2');
    expect(migration).toContain(
      'tenant_id, customer_id, service_id, title, description, priority, status',
    );
    expect(migration).toContain('Suggested slots remain unreserved.');
  });

  it('creates drafts only and records governed evidence', () => {
    expect(migration).toContain('INSERT INTO public.customers');
    expect(migration).toContain('INSERT INTO public.jobs');
    expect(migration).toContain('INSERT INTO public.quotes');
    expect(migration).toContain('INSERT INTO public.quote_line_items');
    expect(migration).toContain("'draft'");
    expect(migration).toContain("'ai.intake_drafts_created'");
    expect(migration).toContain("'ai.intake_execution_rejected'");
    expect(migration).toContain("'slot_reserved', false");
  });
});
