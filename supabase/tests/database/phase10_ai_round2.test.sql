BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(31);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '11000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'follow-owner@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '11000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'other-owner@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '11000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
    'follow-tech@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

INSERT INTO public.tenants (
  id, legal_name, display_name, business_email, time_zone, service_categories
) VALUES
  (
    '22000000-0000-4000-8000-000000000001', 'Follow Up LLC', 'Follow Up',
    'office@follow-up.test', 'America/New_York', ARRAY['Cleaning']
  ),
  (
    '22000000-0000-4000-8000-000000000002', 'Other LLC', 'Other',
    'other@follow-up.test', 'America/Chicago', ARRAY['HVAC']
  );

INSERT INTO public.tenant_settings (tenant_id, ai_operations_enabled, ai_monthly_budget_cents)
VALUES
  ('22000000-0000-4000-8000-000000000001', true, 1000),
  ('22000000-0000-4000-8000-000000000002', true, 1000);

INSERT INTO public.memberships (id, tenant_id, user_id, role, status, joined_at)
VALUES
  (
    '33000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001', 'owner', 'active', now()
  ),
  (
    '33000000-0000-4000-8000-000000000002',
    '22000000-0000-4000-8000-000000000002',
    '11000000-0000-4000-8000-000000000002', 'owner', 'active', now()
  ),
  (
    '33000000-0000-4000-8000-000000000003',
    '22000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000003', 'technician', 'active', now()
  );

INSERT INTO public.staff_availability (
  tenant_id, membership_id, day_of_week, is_available, starts_at, ends_at
) VALUES (
  '22000000-0000-4000-8000-000000000001',
  '33000000-0000-4000-8000-000000000003',
  2, true, '08:00', '18:00'
);

INSERT INTO public.customers (
  id, tenant_id, first_name, last_name, email,
  transactional_email_allowed, marketing_email_opted_in
) VALUES
  (
    '44000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    'Reminder', 'Customer', 'reminder@example.com', true, false
  ),
  (
    '44000000-0000-4000-8000-000000000002',
    '22000000-0000-4000-8000-000000000001',
    'Review', 'Customer', 'review@example.com', true, true
  ),
  (
    '44000000-0000-4000-8000-000000000003',
    '22000000-0000-4000-8000-000000000001',
    'Suppressed', 'Customer', 'suppressed@example.com', true, true
  );

UPDATE public.customers
SET email_suppressed_at = '2026-10-20T15:00:00Z',
    email_suppression_reason = 'Customer requested suppression.'
WHERE id = '44000000-0000-4000-8000-000000000003';

INSERT INTO public.jobs (
  id, tenant_id, customer_id, title
) VALUES
  (
    '55000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000001', 'Reminder job'
  ),
  (
    '55000000-0000-4000-8000-000000000002',
    '22000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000002', 'Review job'
  ),
  (
    '55000000-0000-4000-8000-000000000003',
    '22000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000003', 'Suppressed job'
  ),
  (
    '55000000-0000-4000-8000-000000000004',
    '22000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000001', 'Void job'
  );

UPDATE public.jobs SET status = 'quoted'
WHERE tenant_id = '22000000-0000-4000-8000-000000000001';
UPDATE public.jobs SET status = 'accepted'
WHERE tenant_id = '22000000-0000-4000-8000-000000000001';
UPDATE public.jobs
SET status = 'scheduled',
    assigned_membership_id = '33000000-0000-4000-8000-000000000003',
    scheduled_start_at = CASE id
      WHEN '55000000-0000-4000-8000-000000000001' THEN '2026-10-20T14:00:00Z'::timestamptz
      WHEN '55000000-0000-4000-8000-000000000002' THEN '2026-10-20T15:00:00Z'::timestamptz
      WHEN '55000000-0000-4000-8000-000000000003' THEN '2026-10-20T16:00:00Z'::timestamptz
      ELSE '2026-10-20T17:00:00Z'::timestamptz
    END,
    scheduled_end_at = CASE id
      WHEN '55000000-0000-4000-8000-000000000001' THEN '2026-10-20T15:00:00Z'::timestamptz
      WHEN '55000000-0000-4000-8000-000000000002' THEN '2026-10-20T16:00:00Z'::timestamptz
      WHEN '55000000-0000-4000-8000-000000000003' THEN '2026-10-20T17:00:00Z'::timestamptz
      ELSE '2026-10-20T18:00:00Z'::timestamptz
    END
WHERE tenant_id = '22000000-0000-4000-8000-000000000001';
UPDATE public.jobs SET status = 'in_progress'
WHERE tenant_id = '22000000-0000-4000-8000-000000000001';
UPDATE public.jobs SET status = 'completed'
WHERE tenant_id = '22000000-0000-4000-8000-000000000001';

INSERT INTO public.invoices (
  id, tenant_id, job_id, customer_id, invoice_number, status,
  subtotal_cents, discount_cents, tax_rate_bps, tax_cents, total_cents,
  paid_cents, due_at, voided_at, void_reason
) VALUES
  (
    '66000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    '55000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000001', 1, 'partially_paid',
    12500, 0, 0, 0, 12500, 2500, '2026-10-22T15:00:00Z', NULL, NULL
  ),
  (
    '66000000-0000-4000-8000-000000000002',
    '22000000-0000-4000-8000-000000000001',
    '55000000-0000-4000-8000-000000000002',
    '44000000-0000-4000-8000-000000000002', 2, 'paid',
    20000, 0, 0, 0, 20000, 20000, '2026-10-10T15:00:00Z', NULL, NULL
  ),
  (
    '66000000-0000-4000-8000-000000000003',
    '22000000-0000-4000-8000-000000000001',
    '55000000-0000-4000-8000-000000000003',
    '44000000-0000-4000-8000-000000000003', 3, 'sent',
    10000, 0, 0, 0, 10000, 0, '2026-10-22T15:00:00Z', NULL, NULL
  ),
  (
    '66000000-0000-4000-8000-000000000004',
    '22000000-0000-4000-8000-000000000001',
    '55000000-0000-4000-8000-000000000004',
    '44000000-0000-4000-8000-000000000001', 4, 'void',
    10000, 0, 0, 0, 10000, 0, '2026-10-22T15:00:00Z',
    '2026-10-24T15:00:00Z', 'Voided for integration test.'
  );

INSERT INTO public.payment_records (
  tenant_id, invoice_id, record_type, amount_cents, method, source,
  received_at, recorded_by_user_id
) VALUES
  (
    '22000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000001',
    'payment', 2500, 'cash', 'manual', '2026-10-20T15:00:00Z',
    '11000000-0000-4000-8000-000000000001'
  ),
  (
    '22000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000002',
    'payment', 20000, 'external_transfer', 'provider_confirmed',
    '2026-10-23T15:00:00Z',
    '11000000-0000-4000-8000-000000000001'
  );


INSERT INTO public.services (id, tenant_id, name, unit_price_cents, default_duration_minutes, tax_behavior, is_enabled)
VALUES
  ('99000000-0000-4000-8000-000000000031', '22000000-0000-4000-8000-000000000001', 'AC tune-up', 12900, 120, 'exclusive', true),
  ('99000000-0000-4000-8000-000000000032', '22000000-0000-4000-8000-000000000001', 'Filter (each)', 2500, 60, 'non_taxable', true),
  ('99000000-0000-4000-8000-000000000033', '22000000-0000-4000-8000-000000000001', 'Retired service', 9900, 60, 'exclusive', false),
  ('99000000-0000-4000-8000-000000000034', '22000000-0000-4000-8000-000000000002', 'Other workspace service', 100, 60, 'exclusive', true);

INSERT INTO public.jobs (id, tenant_id, customer_id, service_id, title) VALUES
  ('88000000-0000-4000-8000-000000000031', '22000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000031', 'AC not cooling'),
  ('88000000-0000-4000-8000-000000000032', '22000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000031', 'Second visit');

-- Technician works 08:00-18:00 every day.
INSERT INTO public.staff_availability (tenant_id, membership_id, day_of_week, is_available, starts_at, ends_at)
SELECT '22000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000003', day, true, '08:00', '18:00'
FROM generate_series(0, 6) AS day WHERE day <> 2;
UPDATE public.staff_availability SET starts_at = '08:00', ends_at = '18:00', is_available = true
WHERE membership_id = '33000000-0000-4000-8000-000000000003';

INSERT INTO public.job_work_notes (id, tenant_id, job_id, author_membership_id, body)
VALUES ('aa000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', '55000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000003', 'Se cambió el capacitor del compresor.');

-- 1. Preparing a quote draft
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT * FROM public.prepare_ai_quote_draft('88000000-0000-4000-8000-000000000031', 'short')$$,
  '22023', 'notes must be 10 to 4000 characters', 'Very short notes are rejected'
);
SELECT is(
  (SELECT jsonb_array_length(catalog) FROM public.prepare_ai_quote_draft(
    '88000000-0000-4000-8000-000000000031', 'AC not cooling upstairs, check the unit please')),
  2, 'Only enabled services of this workspace are offered to the model'
);
SELECT throws_ok(
  $$SELECT * FROM public.prepare_ai_quote_draft('55000000-0000-4000-8000-000000000001', 'AC not cooling upstairs please')$$,
  'P0001', 'quotes can only be drafted for new or quoted jobs', 'Completed jobs cannot be quoted'
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT * FROM public.prepare_ai_quote_draft('88000000-0000-4000-8000-000000000031', 'AC not cooling upstairs please')$$,
  '42501', 'job not found or unavailable', 'Technicians cannot draft quotes'
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT * FROM public.prepare_ai_quote_draft('88000000-0000-4000-8000-000000000031', 'AC not cooling upstairs please')$$,
  '42501', 'job not found or unavailable', 'Another workspace cannot draft quotes'
);

-- 2. Recording the model result
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('crewflow.quote_run', public.begin_stub_ai_run(
  '22000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'quote_assistant', 'quote-assistant-v1', gen_random_uuid(),
  'Quote draft from office notes for test job')::text, true);
SELECT throws_ok(
  format($$SELECT public.record_ai_quote_draft(%L, '88000000-0000-4000-8000-000000000031', '[]'::jsonb, '{}', 'x')$$,
    current_setting('crewflow.quote_run')),
  'P0001', 'quote assistant run is not complete', 'Drafts need a finished run'
);
SELECT lives_ok(
  format($$SELECT public.complete_ai_assist_run(%L, 'gpt-6-luna', 1200, 300, 1, 900, NULL)$$,
    current_setting('crewflow.quote_run')),
  'Run is completed with real usage'
);
SELECT ok(
  (SELECT provider = 'openai' AND status = 'succeeded' AND estimated_cost_cents = 1
   FROM public.ai_agent_runs WHERE id = current_setting('crewflow.quote_run')::uuid),
  'Run records provider, status, and cost for the AI budget'
);
SELECT throws_ok(
  format($$SELECT public.complete_ai_assist_run(%L, 'gpt-6-luna', 1, 1, 1, 1, NULL)$$,
    current_setting('crewflow.quote_run')),
  'P0001', 'AI run is not open', 'A run cannot be completed twice'
);
SELECT lives_ok(
  format($$SELECT set_config('crewflow.draft', public.record_ai_quote_draft(%L,
    '88000000-0000-4000-8000-000000000031',
    '[{"serviceId":"99000000-0000-4000-8000-000000000031","quantity":1,"reason":"Tune-up","unitPriceCents":1},
      {"serviceId":"99000000-0000-4000-8000-000000000032","quantity":2.5,"reason":"Filters"},
      {"serviceId":"99000000-0000-4000-8000-000000000033","quantity":1,"reason":"Disabled"},
      {"serviceId":"99000000-0000-4000-8000-000000000034","quantity":1,"reason":"Other workspace"},
      {"serviceId":"not-a-uuid","quantity":1,"reason":"Bogus"},
      {"serviceId":"99000000-0000-4000-8000-000000000031","quantity":"lots","reason":"Bad quantity"}]'::jsonb,
    ARRAY['What size is the unit?'], 'Customer reports AC not cooling.')::text, true)$$,
    current_setting('crewflow.quote_run')),
  'Draft is recorded'
);
SELECT is(
  (SELECT jsonb_array_length(lines) FROM public.ai_quote_drafts WHERE id = current_setting('crewflow.draft')::uuid),
  2, 'Only enabled services of this workspace with numeric quantities survive'
);
SELECT is(
  (SELECT (lines -> 0 ->> 'unitPriceCents')::integer FROM public.ai_quote_drafts WHERE id = current_setting('crewflow.draft')::uuid),
  12900, 'Price comes from the catalog, not from the model'
);
SELECT ok(
  (SELECT (lines -> 1 ->> 'quantity')::numeric = 2.5 AND (lines -> 1 ->> 'taxable')::boolean = false
   FROM public.ai_quote_drafts WHERE id = current_setting('crewflow.draft')::uuid),
  'Quantity and tax flag are kept from the catalog'
);
SELECT is(
  (SELECT missing_information FROM public.ai_quote_drafts WHERE id = current_setting('crewflow.draft')::uuid),
  ARRAY['What size is the unit?'], 'Questions for the customer are stored'
);

-- 3. Note translation
SELECT set_config('crewflow.translation_run', public.begin_stub_ai_run(
  '22000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'translation', 'note-translation-v1', gen_random_uuid(),
  'Translate technician note to en')::text, true);
SELECT lives_ok(
  format($$SELECT public.complete_ai_assist_run(%L, 'gpt-6-luna', 80, 20, 1, 300, NULL)$$,
    current_setting('crewflow.translation_run')),
  'Translation run completes'
);
SELECT lives_ok(
  format($$SELECT public.record_note_translation(%L, %L, 'en', 'Replaced the compressor capacitor.')$$,
    current_setting('crewflow.translation_run'), 'aa000000-0000-4000-8000-000000000001'),
  'Translation is stored'
);
SELECT is(
  (SELECT body FROM public.job_work_notes WHERE id = 'aa000000-0000-4000-8000-000000000001'),
  'Se cambió el capacitor del compresor.', 'The original note is never changed'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT is((SELECT body FROM public.prepare_note_translation('aa000000-0000-4000-8000-000000000001')),
  'Se cambió el capacitor del compresor.', 'Owner can send a note for translation');
SELECT is((SELECT count(*) FROM public.ai_quote_drafts), 1::bigint, 'Owner can read the draft');
SELECT is((SELECT translated_text FROM public.job_note_translations WHERE note_id = 'aa000000-0000-4000-8000-000000000001'),
  'Replaced the compressor capacitor.', 'Owner can read the translation');
SELECT throws_ok(
  $$SELECT public.record_note_translation(gen_random_uuid(), 'aa000000-0000-4000-8000-000000000001', 'en', 'x')$$,
  '42501', NULL, 'Browser users cannot write translations'
);

-- 4. Scheduling help
SELECT is((SELECT count(*) FROM public.suggest_job_slots('88000000-0000-4000-8000-000000000031', 3)), 3::bigint,
  'Three open times are suggested');
SELECT ok(
  (SELECT bool_and(starts_at > now() AND technician_membership_id = '33000000-0000-4000-8000-000000000003'
     AND extract(minute FROM starts_at AT TIME ZONE 'America/New_York') = 0
     AND ends_at - starts_at = interval '120 minutes')
   FROM public.suggest_job_slots('88000000-0000-4000-8000-000000000031', 3)),
  'Slots are in the future, on the hour, and as long as the service'
);
SELECT is((SELECT count(*) FROM (SELECT DISTINCT starts_at FROM public.suggest_job_slots('88000000-0000-4000-8000-000000000031', 3)) AS d), 3::bigint,
  'Each suggestion is a different time');

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.jobs SET status = 'quoted' WHERE id = '88000000-0000-4000-8000-000000000032';
UPDATE public.jobs SET status = 'accepted' WHERE id = '88000000-0000-4000-8000-000000000032';
UPDATE public.jobs
SET status = 'scheduled', assigned_membership_id = '33000000-0000-4000-8000-000000000003',
    scheduled_start_at = ((now() AT TIME ZONE 'America/New_York')::date + 1 + time '10:00') AT TIME ZONE 'America/New_York',
    scheduled_end_at = ((now() AT TIME ZONE 'America/New_York')::date + 1 + time '12:00') AT TIME ZONE 'America/New_York'
WHERE id = '88000000-0000-4000-8000-000000000032';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT ok(
  (SELECT job_count = 1 AND scheduled_minutes = 120 AND available_minutes = 600 AND NOT overbooked
   FROM public.get_technician_workload('22000000-0000-4000-8000-000000000001', 7)
   WHERE work_date = (now() AT TIME ZONE 'America/New_York')::date + 1),
  'Workload counts the scheduled job against working hours'
);
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.staff_availability SET is_available = false
WHERE membership_id = '33000000-0000-4000-8000-000000000003'
  AND day_of_week = extract(dow FROM (now() AT TIME ZONE 'America/New_York')::date + 1)::smallint;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT ok(
  (SELECT overbooked FROM public.get_technician_workload('22000000-0000-4000-8000-000000000001', 7)
   WHERE work_date = (now() AT TIME ZONE 'America/New_York')::date + 1),
  'A job on a day off is flagged as overbooked'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
INSERT INTO public.staff_time_off (tenant_id, membership_id, starts_at, ends_at, reason)
VALUES ('22000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000003', now() - interval '1 day', now() + interval '20 days', 'Vacation');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT is((SELECT count(*) FROM public.suggest_job_slots('88000000-0000-4000-8000-000000000031', 3)), 0::bigint,
  'No times are suggested while the only technician is off');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT * FROM public.suggest_job_slots('88000000-0000-4000-8000-000000000031', 3)$$,
  '42501', 'job not found or unavailable', 'Technicians cannot search slots'
);
SELECT is((SELECT count(*) FROM public.ai_quote_drafts), 0::bigint, 'Technicians cannot read drafts');
SELECT is((SELECT count(*) FROM public.job_note_translations), 0::bigint, 'Technicians cannot read translations');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT * FROM public.get_technician_workload('22000000-0000-4000-8000-000000000001', 7)$$,
  '42501', 'workload is unavailable', 'Another workspace cannot see workload'
);
RESET ROLE;

ROLLBACK;
