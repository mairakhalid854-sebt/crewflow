BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(35);

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

INSERT INTO public.tenant_settings (tenant_id)
VALUES
  ('2a000000-0000-4000-8000-000000000001'),
  ('2a000000-0000-4000-8000-000000000002');

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

INSERT INTO public.staff_availability (
  tenant_id, membership_id, day_of_week, is_available, starts_at, ends_at
) VALUES (
  '2a000000-0000-4000-8000-000000000001',
  '3a000000-0000-4000-8000-000000000002',
  1, true, '08:00', '18:00'
);

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
  ),
  (
    '6a000000-0000-4000-8000-000000000003',
    '2a000000-0000-4000-8000-000000000001',
    '5a000000-0000-4000-8000-000000000001',
    '4a000000-0000-4000-8000-000000000001',
    'Stale proposal job', '2026-10-26T18:00:00Z', '2026-10-26T19:00:00Z'
  ),
  (
    '6a000000-0000-4000-8000-000000000004',
    '2a000000-0000-4000-8000-000000000001',
    '5a000000-0000-4000-8000-000000000001',
    '4a000000-0000-4000-8000-000000000001',
    'Policy change job', '2026-10-26T20:00:00Z', '2026-10-26T21:00:00Z'
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
SELECT throws_ok(
  format(
    'SELECT public.execute_approved_dispatcher_assignment(%L)',
    (current_setting('crewflow.dispatcher_result')::jsonb ->> 'approval_id')::uuid
  ),
  'P0001',
  'Dispatcher assignment requires an approved request',
  'Pending approval cannot execute'
);
SELECT is(
  public.decide_ai_approval(
    (current_setting('crewflow.dispatcher_result')::jsonb ->> 'approval_id')::uuid,
    'approved',
    'Verified assignment policy and schedule.'
  )::text,
  'approved',
  'Owner can explicitly approve the exact assignment'
);
SELECT lives_ok(
  format(
    $query$SELECT set_config(
      'crewflow.dispatcher_execution', row_to_json(result)::text, true
    ) FROM public.execute_approved_dispatcher_assignment(%L) AS result$query$,
    (current_setting('crewflow.dispatcher_result')::jsonb ->> 'approval_id')::uuid
  ),
  'Approved assignment passes guarded execution'
);
SELECT is(
  current_setting('crewflow.dispatcher_execution')::jsonb ->> 'execution_result',
  'succeeded',
  'Guarded execution reports success'
);
SELECT is(
  (
    SELECT assigned_membership_id FROM public.jobs
    WHERE id = '6a000000-0000-4000-8000-000000000001'
  ),
  '3a000000-0000-4000-8000-000000000002'::uuid,
  'Guarded execution applies the approved technician'
);
SELECT is(
  (
    SELECT execution_status FROM public.ai_approval_requests
    WHERE id = (
      current_setting('crewflow.dispatcher_result')::jsonb ->> 'approval_id'
    )::uuid
  ),
  'succeeded',
  'Approval retains execution outcome'
);
SELECT is(
  (
    SELECT count(*) FROM public.ai_run_steps
    WHERE run_id = (current_setting('crewflow.dispatcher_result')::jsonb ->> 'run_id')::uuid
  ),
  3::bigint,
  'Successful execution appends one immutable guarded trace step'
);
SELECT is(
  (
    SELECT execution_result
    FROM public.execute_approved_dispatcher_assignment(
      (current_setting('crewflow.dispatcher_result')::jsonb ->> 'approval_id')::uuid
    )
  ),
  'succeeded',
  'Repeated execution is idempotent'
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

SELECT lives_ok(
  $$SELECT set_config(
    'crewflow.dispatcher_stale', row_to_json(result)::text, true
  ) FROM public.request_dispatcher_proposal(
    '6a000000-0000-4000-8000-000000000003',
    '7a000000-0000-4000-8000-000000000006'
  ) AS result$$,
  'A second eligible job can produce a proposal'
);
SELECT is(
  public.decide_ai_approval(
    (current_setting('crewflow.dispatcher_stale')::jsonb ->> 'approval_id')::uuid,
    'approved',
    'Approved before the job changed.'
  )::text,
  'approved',
  'Stale-case proposal can be approved before mutation'
);
UPDATE public.jobs
SET description = 'Changed after proposal creation.'
WHERE id = '6a000000-0000-4000-8000-000000000003';
-- now() is transaction-stable in pgTAP, so force the captured version to an
-- older value to model the separate web requests used in production.
RESET ROLE;
UPDATE public.ai_approval_requests
SET target_state_version = 'stale-fixture-version'
WHERE id = (
  current_setting('crewflow.dispatcher_stale')::jsonb ->> 'approval_id'
)::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"1a000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT lives_ok(
  format(
    $query$SELECT set_config(
      'crewflow.dispatcher_stale_execution', row_to_json(result)::text, true
    ) FROM public.execute_approved_dispatcher_assignment(%L) AS result$query$,
    (current_setting('crewflow.dispatcher_stale')::jsonb ->> 'approval_id')::uuid
  ),
  'Stale execution is safely recorded'
);
SELECT is(
  current_setting('crewflow.dispatcher_stale_execution')::jsonb ->> 'execution_result',
  'rejected_stale',
  'Changed job state invalidates the approved proposal'
);
SELECT is(
  (
    SELECT assigned_membership_id FROM public.jobs
    WHERE id = '6a000000-0000-4000-8000-000000000003'
  ),
  NULL::uuid,
  'Stale proposal never assigns the technician'
);

SELECT lives_ok(
  $$SELECT set_config(
    'crewflow.dispatcher_policy', row_to_json(result)::text, true
  ) FROM public.request_dispatcher_proposal(
    '6a000000-0000-4000-8000-000000000004',
    '7a000000-0000-4000-8000-000000000007'
  ) AS result$$,
  'Policy-change job can produce a proposal'
);
SELECT is(
  public.decide_ai_approval(
    (current_setting('crewflow.dispatcher_policy')::jsonb ->> 'approval_id')::uuid,
    'approved',
    'Approved before technician eligibility changed.'
  )::text,
  'approved',
  'Policy-change proposal can be approved before eligibility mutation'
);
UPDATE public.staff_profiles
SET service_area_postal_codes = ARRAY['10001']
WHERE membership_id = '3a000000-0000-4000-8000-000000000002';
SELECT lives_ok(
  format(
    $query$SELECT set_config(
      'crewflow.dispatcher_policy_execution', row_to_json(result)::text, true
    ) FROM public.execute_approved_dispatcher_assignment(%L) AS result$query$,
    (current_setting('crewflow.dispatcher_policy')::jsonb ->> 'approval_id')::uuid
  ),
  'Changed eligibility is safely recorded'
);
SELECT is(
  current_setting('crewflow.dispatcher_policy_execution')::jsonb ->> 'execution_result',
  'rejected_policy',
  'Changed service area invalidates the approved proposal'
);
SELECT is(
  (
    SELECT assigned_membership_id FROM public.jobs
    WHERE id = '6a000000-0000-4000-8000-000000000004'
  ),
  NULL::uuid,
  'Policy-rejected proposal never assigns the technician'
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
