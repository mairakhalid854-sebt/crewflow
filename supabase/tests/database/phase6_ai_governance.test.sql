BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(14);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '1b000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'ai-owner@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '1b000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'ai-tech@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

INSERT INTO public.tenants (
  id, legal_name, display_name, business_email, time_zone, service_categories
) VALUES (
  '2b000000-0000-4000-8000-000000000001', 'AI Test LLC', 'AI Test',
  'ai@crewflow.test', 'America/Chicago', ARRAY['HVAC']
);

INSERT INTO public.tenant_settings (tenant_id)
VALUES ('2b000000-0000-4000-8000-000000000001');

INSERT INTO public.memberships (id, tenant_id, user_id, role, status, joined_at)
VALUES
  (
    '3b000000-0000-4000-8000-000000000001',
    '2b000000-0000-4000-8000-000000000001',
    '1b000000-0000-4000-8000-000000000001', 'owner', 'active', now()
  ),
  (
    '3b000000-0000-4000-8000-000000000002',
    '2b000000-0000-4000-8000-000000000001',
    '1b000000-0000-4000-8000-000000000002', 'technician', 'active', now()
  );

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT throws_ok(
  $$SELECT public.begin_stub_ai_run(
    '2b000000-0000-4000-8000-000000000001',
    '1b000000-0000-4000-8000-000000000001',
    'intake', 'phase6-v1',
    '4b000000-0000-4000-8000-000000000001',
    'Redacted intake request'
  )$$,
  '42501',
  'AI operations are disabled',
  'Disabled tenants cannot start AI work'
);

UPDATE public.tenant_settings
SET ai_operations_enabled = true, ai_monthly_budget_cents = 100
WHERE tenant_id = '2b000000-0000-4000-8000-000000000001';

SELECT isnt(
  public.begin_stub_ai_run(
    '2b000000-0000-4000-8000-000000000001',
    '1b000000-0000-4000-8000-000000000001',
    'intake', 'phase6-v1',
    '4b000000-0000-4000-8000-000000000001',
    'Redacted intake request'
  ),
  NULL::uuid,
  'The service boundary can start a governed stub run'
);

SELECT is(
  public.begin_stub_ai_run(
    '2b000000-0000-4000-8000-000000000001',
    '1b000000-0000-4000-8000-000000000001',
    'intake', 'phase6-v1',
    '4b000000-0000-4000-8000-000000000001',
    'Redacted intake request'
  ),
  (
    SELECT id FROM public.ai_agent_runs
    WHERE correlation_id = '4b000000-0000-4000-8000-000000000001'
  ),
  'Identical correlation retries return the original run'
);

SELECT throws_ok(
  $$SELECT public.begin_stub_ai_run(
    '2b000000-0000-4000-8000-000000000001',
    '1b000000-0000-4000-8000-000000000001',
    'intake', 'phase6-v1',
    '4b000000-0000-4000-8000-000000000001',
    'Changed request under the same correlation'
  )$$,
  '23505',
  'AI correlation payload conflict',
  'Changed correlation replays are rejected'
);

INSERT INTO public.ai_run_steps (
  tenant_id, run_id, sequence_number, step_kind, redacted_summary, outcome
)
SELECT tenant_id, id, 1, 'policy_check', 'No customer PII retained', 'allowed'
FROM public.ai_agent_runs
WHERE correlation_id = '4b000000-0000-4000-8000-000000000001';

SELECT throws_ok(
  $$UPDATE public.ai_run_steps SET outcome = 'changed'$$,
  '42501',
  'AI trace steps are immutable',
  'Trace steps cannot be rewritten'
);

INSERT INTO public.ai_approval_requests (
  id, tenant_id, run_id, action_kind, rationale, proposed_changes,
  consequences, target_entity_type, target_entity_id
)
SELECT
  '5b000000-0000-4000-8000-000000000001', tenant_id, id,
  'draft_quote', 'A human must confirm customer-facing pricing.',
  '{"quote_status":"draft"}'::jsonb,
  'Approval creates only a reviewable draft.', 'job',
  '6b000000-0000-4000-8000-000000000001'
FROM public.ai_agent_runs
WHERE correlation_id = '4b000000-0000-4000-8000-000000000001';

INSERT INTO public.ai_approval_requests (
  id, tenant_id, run_id, action_kind, rationale, proposed_changes,
  consequences, created_at, expires_at
)
SELECT
  '5b000000-0000-4000-8000-000000000002', tenant_id, id,
  'draft_quote', 'Expired approval fixture.', '{}'::jsonb,
  'No action may execute after expiry.', now() - interval '49 hours',
  now() - interval '1 hour'
FROM public.ai_agent_runs
WHERE correlation_id = '4b000000-0000-4000-8000-000000000001';

SELECT throws_ok(
  $$INSERT INTO public.ai_approval_requests (
      tenant_id, run_id, action_kind, rationale, proposed_changes, consequences,
      expires_at
    )
    SELECT tenant_id, id, 'unsafe_expiry', 'Invalid long approval.', '{}'::jsonb,
      'It would remain actionable too long.', now() + interval '49 hours'
    FROM public.ai_agent_runs
    LIMIT 1$$,
  '23514',
  NULL,
  'Approval lifetime cannot exceed 48 hours'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"1b000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

SELECT is(
  (SELECT count(*)::integer FROM public.ai_agent_runs),
  0,
  'Technicians cannot read AI runs'
);
SELECT is(
  (SELECT count(*)::integer FROM public.ai_approval_requests),
  0,
  'Technicians cannot read AI approvals'
);
SELECT throws_ok(
  $$SELECT public.decide_ai_approval(
    '5b000000-0000-4000-8000-000000000001', 'approved', 'Looks correct.'
  )$$,
  '42501',
  'approval not found or unavailable',
  'Technicians cannot decide approvals'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"1b000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

SELECT is(
  (SELECT count(*)::integer FROM public.ai_agent_runs),
  1,
  'Owners can inspect their tenant AI runs'
);
SELECT is(
  public.decide_ai_approval(
    '5b000000-0000-4000-8000-000000000001', 'approved', 'Pricing reviewed.'
  ),
  'approved'::public.ai_approval_status,
  'Owner can approve a current request'
);
SELECT throws_ok(
  $$SELECT public.decide_ai_approval(
    '5b000000-0000-4000-8000-000000000001', 'rejected', 'Second decision.'
  )$$,
  'P0001',
  'approval is no longer pending',
  'An approval decision is single-use'
);
SELECT is(
  public.decide_ai_approval(
    '5b000000-0000-4000-8000-000000000002', 'approved', 'Too late.'
  ),
  'expired'::public.ai_approval_status,
  'Expired requests cannot be approved'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.tenant_settings
SET ai_monthly_budget_cents = 0
WHERE tenant_id = '2b000000-0000-4000-8000-000000000001';

SELECT throws_ok(
  $$SELECT public.begin_stub_ai_run(
    '2b000000-0000-4000-8000-000000000001',
    '1b000000-0000-4000-8000-000000000001',
    'report', 'phase6-v1',
    '4b000000-0000-4000-8000-000000000002',
    'Redacted report request'
  )$$,
  'P0001',
  'AI monthly budget exhausted',
  'Budget exhaustion blocks new AI work only'
);

SELECT * FROM finish();
ROLLBACK;
