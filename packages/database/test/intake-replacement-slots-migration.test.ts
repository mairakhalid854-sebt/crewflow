import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610260005_phase6_intake_replacement_slots.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Intake replacement slot generations', () => {
  it('retains prior evidence and bounds each generation to two options', () => {
    expect(migration).toContain('ADD COLUMN offer_generation');
    expect(migration).toContain('offer_generation BETWEEN 1 AND 5');
    expect(migration).toContain(
      'intake_slot_offers_conversion_generation_option_unique',
    );
    expect(migration).toContain('LIMIT 2');
  });

  it('authorizes only the hashed public session or active office roles', () => {
    expect(migration).toContain("auth.role() = 'service_role'");
    expect(migration).toContain("auth.role() = 'authenticated'");
    expect(migration).toContain(
      "ARRAY['owner', 'office']::public.membership_role[]",
    );
    expect(migration).toContain(
      "extensions.digest(pg_catalog.convert_to(session_token, 'UTF8'), 'sha256')",
    );
  });

  it('revalidates current skill, ZIP, availability, time off, and conflicts', () => {
    expect(migration).toContain('profile.service_area_postal_codes');
    expect(migration).toContain('service.required_skills');
    expect(migration).toContain('public.staff_availability');
    expect(migration).toContain('public.staff_time_off');
    expect(migration).toContain(
      "conflict.status IN ('scheduled', 'in_progress')",
    );
  });

  it('never schedules work and exposes only the latest public-safe generation', () => {
    expect(migration).not.toContain('UPDATE public.jobs');
    expect(migration).toContain('offer.offer_generation = current_generation');
    expect(migration).toContain("'booking_confirmed', false");
    expect(migration).not.toContain('technicianMembershipId');
  });

  it('keeps replacement bounded and auditable', () => {
    expect(migration).toContain('replacement slot limit reached');
    expect(migration).toContain("'ai.intake_slots_replaced'");
    expect(migration).toContain('customer_token_action');
  });
});
