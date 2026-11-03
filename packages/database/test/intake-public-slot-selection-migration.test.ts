import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  fileURLToPath(
    new URL(
      '../../../supabase/migrations/202610260003_phase6_intake_public_slot_selection.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

describe('Intake public slot selection migration', () => {
  it('persists exactly two approved proposal options', () => {
    expect(migration).toContain('CREATE TABLE public.intake_slot_offers');
    expect(migration).toContain('option_number BETWEEN 1 AND 2');
    expect(migration).toContain(
      'CREATE FUNCTION public.persist_intake_slot_offers',
    );
    expect(migration).toContain(
      "jsonb_array_length(approval.proposed_changes -> 'slotOptions') <> 2",
    );
  });

  it('keeps public reads and selection behind the hashed session boundary', () => {
    expect(migration).toContain(
      'CREATE FUNCTION public.get_public_intake_slot_status',
    );
    expect(migration).toContain(
      'CREATE FUNCTION public.select_public_intake_slot',
    );
    expect(migration).toContain("auth.role() IS DISTINCT FROM 'service_role'");
    expect(migration).toContain(
      "extensions.digest(pg_catalog.convert_to(session_token, 'UTF8'), 'sha256')",
    );
    expect(migration).toContain('TO service_role');
  });

  it('records a preference without scheduling the job', () => {
    const selectionStart = migration.indexOf(
      'CREATE FUNCTION public.select_public_intake_slot',
    );
    const confirmationStart = migration.indexOf(
      'CREATE FUNCTION public.confirm_intake_selected_slot',
    );
    const selection = migration.slice(selectionStart, confirmationStart);
    expect(selection).toContain("SET status = 'selected', selected_at = now()");
    expect(selection).toContain("'booking_confirmed', false");
    expect(selection).not.toContain('UPDATE public.jobs');
  });

  it('requires quote acceptance and explicit office confirmation to schedule', () => {
    expect(migration).toContain(
      'CREATE FUNCTION public.confirm_intake_selected_slot',
    );
    expect(migration).toContain("job.status <> 'accepted'");
    expect(migration).toContain(
      'customer quote acceptance is required before booking',
    );
    expect(migration).toContain("ARRAY['owner', 'office']");
    expect(migration).toContain(
      'SET assigned_membership_id = chosen.technician_membership_id',
    );
    expect(migration).toContain("status = 'scheduled'");
  });

  it('revalidates eligibility and records both customer and office actions', () => {
    expect(migration).toContain('public.staff_availability');
    expect(migration).toContain('public.staff_time_off');
    expect(migration).toContain(
      "conflict.status IN ('scheduled', 'in_progress')",
    );
    expect(migration).toContain("'ai.intake_slot_selected'");
    expect(migration).toContain("'ai.intake_slot_confirmed'");
  });
});
