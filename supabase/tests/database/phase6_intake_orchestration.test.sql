BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(21);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '1e000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'intake-owner@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '1e000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'intake-tech@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

INSERT INTO public.tenants (
  id, legal_name, display_name, business_email, time_zone, service_categories,
  tax_rate_bps
) VALUES (
  '2e000000-0000-4000-8000-000000000001', 'Intake Tenant LLC',
  'Intake Tenant', 'intake@crewflow.test', 'America/New_York',
  ARRAY['Cleaning'], 800
);

INSERT INTO public.tenant_settings (tenant_id, ai_operations_enabled, ai_monthly_budget_cents)
VALUES ('2e000000-0000-4000-8000-000000000001', true, 1000);

INSERT INTO public.memberships (id, tenant_id, user_id, role, status, joined_at)
VALUES
  (
    '3e000000-0000-4000-8000-000000000001',
    '2e000000-0000-4000-8000-000000000001',
    '1e000000-0000-4000-8000-000000000001', 'owner', 'active', now()
  ),
  (
    '3e000000-0000-4000-8000-000000000002',
    '2e000000-0000-4000-8000-000000000001',
    '1e000000-0000-4000-8000-000000000002', 'technician', 'active', now()
  );

UPDATE public.staff_profiles
SET skills = ARRAY['Gutter Cleaning'],
    service_area_postal_codes = ARRAY['10901']
WHERE membership_id = '3e000000-0000-4000-8000-000000000002';

INSERT INTO public.staff_availability (
  tenant_id, membership_id, day_of_week, is_available, starts_at, ends_at
)
SELECT
  '2e000000-0000-4000-8000-000000000001',
  '3e000000-0000-4000-8000-000000000002', day_number,
  true, '09:00', '17:00'
FROM generate_series(0, 6) AS day_number;

INSERT INTO public.services (
  id, tenant_id, name, unit_price_cents, default_duration_minutes,
  required_skills
) VALUES (
  '4e000000-0000-4000-8000-000000000001',
  '2e000000-0000-4000-8000-000000000001',
  'Gutter Cleaning', 15000, 60, ARRAY['gutter cleaning']
);

INSERT INTO public.intake_conversations (
  id, tenant_id, session_token_hash, status, stage, collected_values,
  catalog_snapshot, selected_service_id
) VALUES (
  '5e000000-0000-4000-8000-000000000001',
  '2e000000-0000-4000-8000-000000000001', repeat('a', 64),
  'ready_for_human_review', 'complete',
  jsonb_build_object(
    'customerName', 'Casey Customer',
    'contact', jsonb_build_object('kind', 'email', 'value', 'casey@example.test'),
    'address', '123 Main Street, Suffern NY 10901',
    'problem', 'Gutters are overflowing during rainfall.',
    'serviceName', 'Gutter Cleaning'
  ),
  '[]'::jsonb,
  '4e000000-0000-4000-8000-000000000001'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"1e000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
SELECT throws_ok(
  $$SELECT public.request_intake_quote_slot_proposal(
    '5e000000-0000-4000-8000-000000000001',
    '6e000000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  'active office membership required',
  'Technician cannot request an Intake proposal'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"1e000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT lives_ok(
  $$SELECT set_config(
    'crewflow.intake_result', row_to_json(result)::text, true
  ) FROM public.request_intake_quote_slot_proposal(
    '5e000000-0000-4000-8000-000000000001',
    '6e000000-0000-4000-8000-000000000002'
  ) AS result$$,
  'Owner can request an authoritative Intake proposal'
);
SELECT is(
  current_setting('crewflow.intake_result')::jsonb ->> 'proposal_result',
  'proposed',
  'Eligible Intake produces a proposal'
);
SELECT is(
  jsonb_array_length((
    SELECT proposed_changes -> 'slotOptions'
    FROM public.ai_approval_requests
    WHERE id = (current_setting('crewflow.intake_result')::jsonb ->> 'approval_id')::uuid
  )),
  2,
  'Proposal includes exactly two verified slot options'
);
SELECT is(
  (
    SELECT proposed_changes #>> '{quote,totalCents}'
    FROM public.ai_approval_requests
    WHERE id = (current_setting('crewflow.intake_result')::jsonb ->> 'approval_id')::uuid
  ),
  '16200',
  'Proposal uses current catalog price and tenant tax'
);
SELECT is((SELECT count(*) FROM public.customers), 0::bigint,
  'Proposal creates no customer');
SELECT is((SELECT count(*) FROM public.jobs), 0::bigint,
  'Proposal creates no job');
SELECT is((SELECT count(*) FROM public.quotes), 0::bigint,
  'Proposal creates no quote');
SELECT throws_ok(
  format(
    'SELECT public.execute_approved_intake_draft_records(%L)',
    (current_setting('crewflow.intake_result')::jsonb ->> 'approval_id')::uuid
  ),
  'P0001',
  'Intake draft creation requires an approved request',
  'Pending Intake approval cannot execute'
);
SELECT is(
  public.decide_ai_approval(
    (current_setting('crewflow.intake_result')::jsonb ->> 'approval_id')::uuid,
    'approved',
    'Verified customer, quote, and suggested slot details.'
  )::text,
  'approved',
  'Owner can approve the exact Intake proposal'
);
SELECT lives_ok(
  format(
    $query$SELECT set_config(
      'crewflow.intake_execution', row_to_json(result)::text, true
    ) FROM public.execute_approved_intake_draft_records(%L) AS result$query$,
    (current_setting('crewflow.intake_result')::jsonb ->> 'approval_id')::uuid
  ),
  'Approved Intake proposal passes guarded execution'
);
SELECT is(
  current_setting('crewflow.intake_execution')::jsonb ->> 'execution_result',
  'succeeded',
  'Guarded Intake execution reports success'
);
SELECT is((SELECT count(*) FROM public.customers), 1::bigint,
  'Execution creates exactly one customer');
SELECT is((SELECT count(*) FROM public.jobs), 1::bigint,
  'Execution creates exactly one job');
SELECT is((SELECT count(*) FROM public.quotes), 1::bigint,
  'Execution creates exactly one quote');
SELECT is(
  (SELECT status::text FROM public.jobs LIMIT 1),
  'new',
  'Created job remains an editable new draft'
);
SELECT is(
  (SELECT assigned_membership_id FROM public.jobs LIMIT 1),
  NULL::uuid,
  'Created job has no technician assignment'
);
SELECT is(
  (SELECT scheduled_start_at FROM public.jobs LIMIT 1),
  NULL::timestamptz,
  'Suggested slots are not reserved on the job'
);
SELECT is(
  (SELECT status::text FROM public.quotes LIMIT 1),
  'draft',
  'Created quote is not sent automatically'
);
SELECT is(
  (
    SELECT execution_result
    FROM public.execute_approved_intake_draft_records(
      (current_setting('crewflow.intake_result')::jsonb ->> 'approval_id')::uuid
    )
  ),
  'succeeded',
  'Repeated execution is idempotent'
);
SELECT is((SELECT count(*) FROM public.intake_draft_conversions), 1::bigint,
  'One immutable conversion links all created drafts');

SELECT * FROM finish();
ROLLBACK;
