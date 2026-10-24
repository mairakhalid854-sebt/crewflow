BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(32);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '1a000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'billing-owner@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '1a000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'billing-tech@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

INSERT INTO public.tenants (
  id, legal_name, display_name, business_email, time_zone, service_categories
) VALUES (
  '2a000000-0000-4000-8000-000000000001', 'Billing Tenant LLC',
  'Billing Tenant', 'billing@crewflow.test', 'America/Chicago', ARRAY['HVAC']
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
  );

SELECT is(
  (
    SELECT plan_code || '/' || status::text || '/' || access_mode::text
    FROM public.tenant_subscriptions
    WHERE tenant_id = '2a000000-0000-4000-8000-000000000001'
  ),
  'development_stub/active/full',
  'Every tenant starts with a price-free full-access stub entitlement'
);

SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT * FROM public.get_owner_billing_summary()$$,
  '42501',
  'permission denied for function get_owner_billing_summary',
  'Anonymous callers cannot inspect billing details'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"1a000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
SELECT throws_ok(
  $$SELECT * FROM public.get_owner_billing_summary()$$,
  '42501',
  'owner membership required',
  'Technicians cannot inspect the owner billing summary'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"1a000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT is(
  (SELECT plan_code FROM public.get_owner_billing_summary()),
  'development_stub',
  'The owner can read the current entitlement'
);
SELECT lives_ok(
  $$INSERT INTO public.customers (
      id, tenant_id, first_name, last_name, postal_code
    ) VALUES (
      '5a000000-0000-4000-8000-000000000001',
      '2a000000-0000-4000-8000-000000000001',
      'Full', 'Access', '78701'
    )$$,
  'Full access permits normal tenant writes'
);
SELECT throws_ok(
  $$SELECT public.apply_paddle_sandbox_subscription_event(
    'evt_' || repeat('a', 25) || '0',
    'subscription.activated',
    '2026-10-24T00:00:00Z',
    repeat('0', 64),
    '2a000000-0000-4000-8000-000000000001',
    'ctm_' || repeat('a', 26),
    'sub_' || repeat('b', 26),
    'pri_01m5ftaym9s2q2ea2etcgzrx1z',
    'active',
    '2026-11-05T12:31:44.449Z',
    '2026-12-05T12:31:44.449Z',
    false
  )$$,
  '42501',
  'permission denied for function apply_paddle_sandbox_subscription_event',
  'Authenticated callers cannot apply provider events'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
SELECT is(
  public.apply_paddle_sandbox_subscription_event(
    'evt_' || repeat('a', 25) || '1',
    'subscription.activated',
    '2026-10-24T00:00:00Z',
    repeat('1', 64),
    '2a000000-0000-4000-8000-000000000099',
    'ctm_' || repeat('a', 26),
    'sub_' || repeat('b', 26),
    'pri_01m5ftaym9s2q2ea2etcgzrx1z',
    'active',
    '2026-11-05T12:31:44.449Z',
    '2026-12-05T12:31:44.449Z',
    false
  ),
  'tenant_not_found',
  'An unknown tenant is rejected without a foreign-key crash'
);
SELECT ok(
  (
    SELECT tenant_id IS NULL
    FROM public.billing_webhook_events
    WHERE external_event_id = 'evt_' || repeat('a', 25) || '1'
  ),
  'The failed unknown-tenant event retains no dangling tenant reference'
);
SELECT is(
  (
    SELECT status::text || '/' || failure_code
    FROM public.billing_webhook_events
    WHERE external_event_id = 'evt_' || repeat('a', 25) || '1'
  ),
  'failed/tenant_not_found',
  'The unknown-tenant attempt remains auditable with a bounded failure code'
);

SELECT is(
  public.apply_paddle_sandbox_subscription_event(
    'evt_' || repeat('a', 25) || '2',
    'subscription.activated',
    '2026-10-24T00:00:00Z',
    repeat('2', 64),
    '2a000000-0000-4000-8000-000000000001',
    'ctm_' || repeat('a', 26),
    'sub_' || repeat('b', 26),
    'pri_01m5ftaym9s2q2ea2etcgzrx1z',
    'active',
    '2026-11-05T12:31:44.449Z',
    '2026-12-05T12:31:44.449Z',
    false
  ),
  'processed',
  'A configured Paddle activation is processed'
);
SELECT is(
  (
    SELECT status::text || '/' || access_mode::text
    FROM public.tenant_subscriptions
    WHERE tenant_id = '2a000000-0000-4000-8000-000000000001'
  ),
  'active/full',
  'Activation grants full access'
);
SELECT is(
  (
    SELECT plan_code || '/' || current_period_ends_at::date::text
    FROM public.tenant_subscriptions
    WHERE tenant_id = '2a000000-0000-4000-8000-000000000001'
  ),
  'starter_monthly_sandbox/2026-12-05',
  'The provider price maps to the configured plan and billing period'
);
SELECT is(
  (
    SELECT status::text
    FROM public.billing_webhook_events
    WHERE external_event_id = 'evt_' || repeat('a', 25) || '2'
  ),
  'processed',
  'The processed event stores only bounded webhook metadata'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.audit_events
    WHERE tenant_id = '2a000000-0000-4000-8000-000000000001'
      AND action = 'billing.entitlement_synced'
  ),
  1::bigint,
  'An entitlement change creates one tenant audit event'
);
SELECT is(
  public.apply_paddle_sandbox_subscription_event(
    'evt_' || repeat('a', 25) || '2',
    'subscription.activated', '2026-10-24T00:00:00Z', repeat('2', 64),
    '2a000000-0000-4000-8000-000000000001',
    'ctm_' || repeat('a', 26), 'sub_' || repeat('b', 26),
    'pri_01m5ftaym9s2q2ea2etcgzrx1z', 'active',
    '2026-11-05T12:31:44.449Z', '2026-12-05T12:31:44.449Z', false
  ),
  'duplicate',
  'An exact replay is idempotent'
);
SELECT is(
  public.apply_paddle_sandbox_subscription_event(
    'evt_' || repeat('a', 25) || '2',
    'subscription.activated', '2026-10-24T00:00:00Z', repeat('3', 64),
    '2a000000-0000-4000-8000-000000000001',
    'ctm_' || repeat('a', 26), 'sub_' || repeat('b', 26),
    'pri_01m5ftaym9s2q2ea2etcgzrx1z', 'active',
    '2026-11-05T12:31:44.449Z', '2026-12-05T12:31:44.449Z', false
  ),
  'payload_conflict',
  'A changed replay payload is rejected'
);
SELECT is(
  public.apply_paddle_sandbox_subscription_event(
    'evt_' || repeat('a', 25) || '3',
    'subscription.canceled', '2026-10-23T23:59:59Z', repeat('4', 64),
    '2a000000-0000-4000-8000-000000000001',
    'ctm_' || repeat('a', 26), 'sub_' || repeat('b', 26),
    'pri_01m5ftaym9s2q2ea2etcgzrx1z', 'canceled',
    '2026-11-05T12:31:44.449Z', '2026-12-05T12:31:44.449Z', false
  ),
  'out_of_order',
  'An older provider snapshot is ignored'
);
SELECT is(
  (
    SELECT status::text || '/' || access_mode::text
    FROM public.tenant_subscriptions
    WHERE tenant_id = '2a000000-0000-4000-8000-000000000001'
  ),
  'active/full',
  'An out-of-order cancellation cannot revoke current access'
);

SELECT is(
  public.apply_paddle_sandbox_subscription_event(
    'evt_' || repeat('a', 25) || '4',
    'subscription.past_due', '2026-10-24T01:00:00Z', repeat('5', 64),
    '2a000000-0000-4000-8000-000000000001',
    'ctm_' || repeat('a', 26), 'sub_' || repeat('b', 26),
    'pri_01m5ftaym9s2q2ea2etcgzrx1z', 'past_due',
    '2026-11-05T12:31:44.449Z', '2026-12-05T12:31:44.449Z', false
  ),
  'processed',
  'A failed-payment event is processed'
);
SELECT is(
  (SELECT access_mode::text FROM public.tenant_subscriptions WHERE tenant_id = '2a000000-0000-4000-8000-000000000001'),
  'grace',
  'Past-due status enters grace access'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"1a000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT lives_ok(
  $$INSERT INTO public.customers (
      id, tenant_id, first_name, last_name, postal_code
    ) VALUES (
      '5a000000-0000-4000-8000-000000000002',
      '2a000000-0000-4000-8000-000000000001',
      'Grace', 'Access', '78702'
    )$$,
  'Grace access still permits tenant writes'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
SELECT is(
  public.apply_paddle_sandbox_subscription_event(
    'evt_' || repeat('a', 25) || '5',
    'subscription.paused', '2026-10-24T02:00:00Z', repeat('6', 64),
    '2a000000-0000-4000-8000-000000000001',
    'ctm_' || repeat('a', 26), 'sub_' || repeat('b', 26),
    'pri_01m5ftaym9s2q2ea2etcgzrx1z', 'paused',
    '2026-11-05T12:31:44.449Z', '2026-12-05T12:31:44.449Z', false
  ),
  'processed',
  'A pause event is processed'
);
SELECT is(
  (
    SELECT status::text || '/' || access_mode::text
    FROM public.tenant_subscriptions
    WHERE tenant_id = '2a000000-0000-4000-8000-000000000001'
  ),
  'paused/read_only',
  'A paused subscription preserves data behind read-only access'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"1a000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT throws_ok(
  $$INSERT INTO public.customers (
      id, tenant_id, first_name, last_name, postal_code
    ) VALUES (
      '5a000000-0000-4000-8000-000000000003',
      '2a000000-0000-4000-8000-000000000001',
      'Blocked', 'Write', '78703'
    )$$,
  '42501',
  'subscription is read-only',
  'Read-only access blocks business-record writes'
);
SELECT is(
  (
    SELECT subscription_status::text || '/' || access_mode::text
    FROM public.get_owner_billing_summary()
  ),
  'paused/read_only',
  'The owner can still inspect billing while the workspace is read-only'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
SELECT is(
  public.apply_paddle_sandbox_subscription_event(
    'evt_' || repeat('a', 25) || '6',
    'subscription.resumed', '2026-10-24T03:00:00Z', repeat('7', 64),
    '2a000000-0000-4000-8000-000000000001',
    'ctm_' || repeat('a', 26), 'sub_' || repeat('b', 26),
    'pri_01m5ftaym9s2q2ea2etcgzrx1z', 'active',
    '2026-11-05T12:31:44.449Z', '2026-12-05T12:31:44.449Z', false
  ),
  'processed',
  'A resume event is processed'
);
SELECT is(
  (
    SELECT status::text || '/' || access_mode::text
    FROM public.tenant_subscriptions
    WHERE tenant_id = '2a000000-0000-4000-8000-000000000001'
  ),
  'active/full',
  'Resuming restores full access'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"1a000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT lives_ok(
  $$INSERT INTO public.customers (
      id, tenant_id, first_name, last_name, postal_code
    ) VALUES (
      '5a000000-0000-4000-8000-000000000004',
      '2a000000-0000-4000-8000-000000000001',
      'Restored', 'Access', '78704'
    )$$,
  'Restored full access permits writes again'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
SELECT is(
  public.apply_paddle_sandbox_subscription_event(
    'evt_' || repeat('a', 25) || '7',
    'subscription.canceled', '2026-10-24T04:00:00Z', repeat('8', 64),
    '2a000000-0000-4000-8000-000000000001',
    'ctm_' || repeat('a', 26), 'sub_' || repeat('b', 26),
    'pri_01m5ftaym9s2q2ea2etcgzrx1z', 'canceled',
    '2026-11-05T12:31:44.449Z', '2026-12-05T12:31:44.449Z', false
  ),
  'processed',
  'A cancellation event is processed'
);
SELECT is(
  (
    SELECT status::text || '/' || access_mode::text
    FROM public.tenant_subscriptions
    WHERE tenant_id = '2a000000-0000-4000-8000-000000000001'
  ),
  'canceled/read_only',
  'Cancellation preserves data behind read-only access'
);
SELECT ok(
  (
    SELECT count(*) = 3
    FROM public.customers
    WHERE tenant_id = '2a000000-0000-4000-8000-000000000001'
  ),
  'Entitlement changes never delete existing customer data'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"1a000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT throws_ok(
  $$SELECT count(*) FROM public.tenant_subscriptions$$,
  '42501',
  'permission denied for table tenant_subscriptions',
  'Authenticated users cannot read private provider identifiers directly'
);

SELECT * FROM finish();
ROLLBACK;
