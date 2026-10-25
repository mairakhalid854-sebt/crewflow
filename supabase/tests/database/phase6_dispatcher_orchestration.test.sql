BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(17);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '1a000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'dispatcher-owner@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '1a000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'dispatcher-tech@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '1a000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
    'dispatcher-other-owner@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

INSERT INTO public.tenants (
  id, legal_name, display_name, business_email, time_zone, service_categories
) VALUES
  (
    '2a000000-0000-4000-8000-000000000001', 'Dispatcher Tenant LLC',
    'Dispatcher Tenant', 'dispatcher@crewflow.test', 'America/New_York', ARRAY['Cleaning']
  ),
  (
    '2a000000-0000-4000-8000-000000000002', 'Other Dispatcher LLC',
    'Other Dispatcher', 'other-dispatcher@crewflow.test', 'America/Chicago', ARRAY['HVAC']
  );

INSERT INTO public.memberships (id, tenant_id, user_id, role, status, joined_at)
VALUES
  (
    '3a000000-0000-4000-8000-000000000001',
    '2a000000-0000-4000-8000-000000000001',
    '1a000000-0000-4000-8000-000000000001', 'owner', 'active', now()
  ),
  (
    '3a000000-0000-4000-8000-000000000002',
    '2a000000-0000-4000-8000-000000000001',
    '1a000000-0000-4000-8000-000000000002', 'technician', 'active', now()
  ),
  (
    '3a000000-0000-4000-8000-000000000003',
    '2a000000-0000-4000-8000-000000000002',
    '1a000000-0000-4000-8000-000000000003', 'owner', 'active', now()
  );

UPDATE public.staff_profiles
SET skills = ARRAY['Gutter Cleaning'],
    service_area_postal_codes = ARRAY['10901']
WHERE membership_id = '3a000000-0000-4000-8000-000000000002';

UPDATE public.staff_availability
SET is_available = true,
    starts_at = '08:00',
    ends_at = '18:00'
WHERE membership_id = '3a000000-0000-4000-8000-000000000002'
  AND day_of_week = 1;

INSERT INTO public.services (
  id, tenant_id, name, unit_price_cents, default_duration_minutes,
  required_skills
) VALUES (
  '4a000000-0000-4000-8000-000000000001',
  '2a000000-0000-4000-8000-000000000001',
  'Gutter Cleaning', 15000, 60, ARRAY['gutter cleaning']
);

INSERT INTO public.customers (
  id, tenant_id, first_name, last_name, postal_code
) VALUES
  (
    '5a000000-0000-4000-8000-000000000001',
    '2a000000-0000-4000-8000-000000000001',
    'Eligible', 'Customer', '10901'
  ),
  (
    '5a000000-0000-4000-8000-000000000002',
    '2a000000-0000-4000-8000-000000000001',
    'Outside', 'Customer', '10001'
  );

INSERT INTO public.jobs (
  id, tenant_id, customer_id, service_id, title,
  scheduled_start_at, scheduled_end_at
) VALUES
  (
    '6a000000-0000-4000-8000-000000000001',
    '2a000000-0000-4000-8000-000000000001',
    '5a000000-0000-4000-8000-000000000001',
    '4a000000-0000-4000-8000-000000000001',
    'Eligible gutter job', '2026-10-26T14:00:00Z', '2026-10-26T15:00:00Z'
  ),
  (
    '6a000000-0000-4000-8000-000000000002',
    '2a000000-0000-4000-8000-000000000001',
    '5a000000-0000-4000-8000-000000000002',
    '4a000000-0000-4000-8000-000000000001',
    'Outside service area', '2026-10-26T16:00:00Z', '2026-10-26T17:00:00Z'
  );

UPDATE public.jobs SET status = 'quoted';
UPDATE public.jobs SET status = 'accepted';

UPDATE public.tenant_settings
SET ai_operations_enabled = true, ai_monthly_budget_cents = 1000
WHERE tenant_id = '2a000000-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"1a000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
SELECT throws_ok(
  $$SELECT public.request_dispatcher_proposal(
    '6a000000-0000-4000-8000-000000000001',
    '7a000000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  'active office membership required',
  'Technician cannot request a Dispatcher proposal'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"1a000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
SELECT throws_ok(
  $$SELECT public.request_dispatcher_proposal(
    '6a000000-0000-4000-8000-000000000001',
    '7a000000-0000-4000-8000-000000000002'
  )$$,
  '42501',
  'active office membership required',
  'Another tenant owner cannot request a proposal for the job'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"1a000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT lives_ok(
  $$SELECT set_config(
    'crewflow.dispatcher_result', row_to_json(result)::text, true
  ) FROM public.request_dispatcher_proposal(
    '6a000000-0000-4000-8000-000000000001',
    '7a000000-0000-4000-8000-000000000003'
  ) AS result$$,
  'Owner can request an authoritative Dispatcher proposal'
);
SELECT is(
  current_setting('crewflow.dispatcher_result')::jsonb ->> 'proposal_result',
  'proposed',
  'Eligible assignment produces a proposal'
);
SELECT is(
  current_setting('crewflow.dispatcher_result')::jsonb ->> 'technician_membership_id',
  '3a000000-0000-4000-8000-000000000002',
  'Skills, ZIP, availability, and conflicts select the eligible technician'
);
SELECT is(
  (SELECT count(*) FROM public.ai_approval_requests WHERE status = 'pending'),
  1::bigint,
  'Proposal creates one pending human approval'
);
SELECT is(
  (
    SELECT proposed_changes -> 'assignedMembershipId' ->> 'to'
    FROM public.ai_approval_requests LIMIT 1
  ),
  '3a000000-0000-4000-8000-000000000002',
  'Approval stores the exact proposed assignment diff'
);
SELECT is(
  (
    SELECT agent_kind::text || ':' || status::text
    FROM public.ai_agent_runs
    WHERE id = (current_setting('crewflow.dispatcher_result')::jsonb ->> 'run_id')::uuid
  ),
  'dispatcher:succeeded',
  'Proposal records a completed governed Dispatcher run'
);
SELECT is(
  (
    SELECT count(*) FROM public.ai_run_steps
    WHERE run_id = (current_setting('crewflow.dispatcher_result')::jsonb ->> 'run_id')::uuid
  ),
  2::bigint,
  'Proposal records candidate and approval trace steps'
);
SELECT is(
  (
    SELECT assigned_membership_id FROM public.jobs
    WHERE id = '6a000000-0000-4000-8000-000000000001'
  ),
  NULL::uuid,
  'Dispatcher proposal never mutates the job assignment'
);
SELECT lives_ok(
  $$SELECT set_config(
    'crewflow.dispatcher_repeat', row_to_json(result)::text, true
  ) FROM public.request_dispatcher_proposal(
    '6a000000-0000-4000-8000-000000000001',
    '7a000000-0000-4000-8000-000000000003'
  ) AS result$$,
  'Repeating the same correlation is idempotent'
);
SELECT is(
  current_setting('crewflow.dispatcher_repeat')::jsonb ->> 'run_id',
  current_setting('crewflow.dispatcher_result')::jsonb ->> 'run_id',
  'Idempotent repeat returns the original run'
);
SELECT lives_ok(
  $$SELECT set_config(
    'crewflow.dispatcher_escalation', row_to_json(result)::text, true
  ) FROM public.request_dispatcher_proposal(
    '6a000000-0000-4000-8000-000000000002',
    '7a000000-0000-4000-8000-000000000004'
  ) AS result$$,
  'No-candidate evaluation completes as an escalation'
);
SELECT is(
  current_setting('crewflow.dispatcher_escalation')::jsonb ->> 'proposal_result',
  'escalated',
  'Outside service area cannot produce an assignment suggestion'
);
SELECT is(
  (
    SELECT count(*) FROM public.ai_approval_requests
    WHERE run_id = (
      current_setting('crewflow.dispatcher_escalation')::jsonb ->> 'run_id'
    )::uuid
  ),
  0::bigint,
  'Escalation creates no approval action'
);
SELECT is(
  (
    SELECT count(*) FROM public.audit_events
    WHERE action IN ('ai.dispatcher_proposed', 'ai.dispatcher_escalated')
  ),
  2::bigint,
  'Proposal and escalation are both audited'
);

UPDATE public.tenant_settings
SET ai_operations_enabled = false
WHERE tenant_id = '2a000000-0000-4000-8000-000000000001';
SELECT throws_ok(
  $$SELECT public.request_dispatcher_proposal(
    '6a000000-0000-4000-8000-000000000001',
    '7a000000-0000-4000-8000-000000000005'
  )$$,
  '42501',
  'AI operations are disabled',
  'Disabled AI setting blocks new Dispatcher work'
);

SELECT * FROM finish();
ROLLBACK;
