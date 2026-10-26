import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  fileURLToPath(
    new URL(
      '../../../supabase/migrations/202610260001_phase6_intake_quote_slot_orchestration.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

describe('Intake quote and slot orchestration migration', () => {
  it('reads authoritative conversation, service, availability, time off, and jobs', () => {
    expect(migration).toContain('public.intake_conversations');
    expect(migration).toContain('public.services');
    expect(migration).toContain('public.staff_availability');
    expect(migration).toContain('public.staff_time_off');
    expect(migration).toContain('public.jobs');
  });

  it('enforces tenant roles, AI settings, and budget', () => {
    expect(migration).toContain("membership.role IN ('owner', 'office')");
    expect(migration).toContain('ai_operations_enabled');
    expect(migration).toContain('AI monthly budget exhausted');
  });

  it('grounds price and selects exactly two conflict-safe slots', () => {
    expect(migration).toContain('service.unit_price_cents');
    expect(migration).toContain('LIMIT 2');
    expect(migration).toContain('slot_count < 2');
    expect(migration).toContain("job.status IN ('scheduled', 'in_progress')");
  });

  it('creates governed evidence and an exact approval only', () => {
    expect(migration).toContain("'intake.create_draft_records'");
    expect(migration).toContain('public.ai_agent_runs');
    expect(migration).toContain('public.ai_run_steps');
    expect(migration).toContain('public.ai_approval_requests');
    expect(migration).not.toContain('INSERT INTO public.customers');
    expect(migration).not.toContain('INSERT INTO public.quotes');
  });

  it('documents non-reservation and no-booking consequences', () => {
    expect(migration).toContain('will not assign a technician');
    expect(migration).toContain('confirm a booking');
    expect(migration).toContain('two non-reserved slot options');
  });
});
