BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(20);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '8b000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'live-owner@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '8b000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'live-tech@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '8b000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
    'sandbox-owner@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

INSERT INTO public.tenants (
  id, legal_name, display_name, business_email, time_zone, service_categories
) VALUES
  (
    '8c000000-0000-4000-8000-000000000001', 'Live Billing LLC',
    'Live Billing', 'live@crewflow.test', 'America/Chicago', ARRAY['HVAC']
  ),
  (
    '8c000000-0000-4000-8000-000000000002', 'Sandbox Billing LLC',
    'Sandbox Billing', 'sandbox@crewflow.test', 'America/Chicago', ARRAY['HVAC']
  );

SELECT lives_ok(
  $$INSERT INTO public.memberships (id, tenant_id, user_id, role, status, joined_at)
    VALUES
      (
        '8d000000-0000-4000-8000-000000000001',
        '8c000000-0000-4000-8000-000000000001',
        '8b000000-0000-4000-8000-000000000001', 'owner', 'active', now()
      ),
      (
        '8d000000-0000-4000-8000-000000000002',
        '8c000000-0000-4000-8000-000000000001',
        '8b000000-0000-4000-8000-000000000002', 'technician', 'active', now()
      ),
      (
        '8d000000-0000-4000-8000-000000000003',
        '8c000000-0000-4000-8000-000000000002',
        '8b000000-0000-4000-8000-000000000003', 'owner', 'active', now()
      )$$,
  'Workspace setup writes succeed before the creating transaction commits'
);

-- Fire the deferred checkout trigger as the creating transaction's commit would.
SET CONSTRAINTS public.tenants_require_checkout IMMEDIATE;

SELECT is(
  (
    SELECT plan_code || '/' || status::text || '/' || access_mode::text
    FROM public.tenant_subscriptions
    WHERE tenant_id = '8c000000-0000-4000-8000-000000000001'
  ),
  'checkout_required/paused/read_only',
  'A new workspace must choose a plan once its creating transaction commits'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.billing_plans
    WHERE provider = 'paddle'
      AND is_active
      AND NOT is_development_only
      AND trial_days = 14
  ),
  3,
  'Three active live plans with a 14-day trial are configured'
);

SELECT throws_ok(
  $$INSERT INTO public.billing_plans (
      code, provider, display_name, billing_interval, provider_price_id,
      amount_cents, is_active, is_development_only
    ) VALUES (
      'bad_live_plan', 'paddle', 'Bad live plan', 'month',
      'pri_' || repeat('z', 26), 100, true, true
    )$$,
  '23514',
  NULL,
  'Live plans cannot be marked development-only'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"8b000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

SELECT ok(
  public.get_current_tenant_requires_checkout(),
  'The owner is told to choose a plan'
);

SELECT throws_ok(
  $$INSERT INTO public.customers (
      id, tenant_id, first_name, last_name, postal_code
    ) VALUES (
      '8e000000-0000-4000-8000-000000000001',
      '8c000000-0000-4000-8000-000000000001',
      'Blocked', 'Write', '78701'
    )$$,
  '42501',
  'subscription is read-only',
  'Business records stay read-only until a subscription starts'
);

SELECT is(
  ARRAY(
    SELECT code || ':' || provider_price_id
    FROM public.list_owner_paddle_plans('paddle')
  ),
  ARRAY[
    'starter_monthly:pri_01m6k8spcay1tgqctewmv8jhwh',
    'growth_monthly:pri_01m6k8vg3stm76898n4673n648',
    'pro_monthly:pri_01m6k8x4a6ehvnyex8bqtgs2ts'
  ],
  'Owners see the live catalog in price order'
);

SELECT is(
  (SELECT count(*)::integer FROM public.list_owner_paddle_plans('paddle_sandbox')),
  3,
  'Owners see the sandbox catalog separately'
);

SELECT is(
  (SELECT count(*)::integer FROM public.list_owner_paddle_plans('stub')),
  0,
  'The stub provider has no checkout catalog'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"8b000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
SELECT is(
  (SELECT count(*)::integer FROM public.list_owner_paddle_plans('paddle')),
  0,
  'Technicians cannot list checkout plans'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT throws_ok(
  $$SELECT public.apply_paddle_subscription_event(
    'stub',
    'evt_' || repeat('c', 25) || '0',
    'subscription.trialing',
    '2026-11-04T00:00:00Z',
    repeat('2', 64),
    '8c000000-0000-4000-8000-000000000001',
    'ctm_' || repeat('c', 26),
    'sub_' || repeat('d', 26),
    'pri_01m6k8spcay1tgqctewmv8jhwh',
    'trialing',
    '2026-11-04T00:00:00Z',
    '2026-11-18T00:00:00Z',
    false
  )$$,
  '22023',
  'unsupported Paddle provider',
  'Only Paddle providers can apply webhook events'
);

SELECT is(
  public.apply_paddle_subscription_event(
    'paddle',
    'evt_' || repeat('c', 25) || '1',
    'subscription.trialing',
    '2026-11-04T00:00:00Z',
    repeat('3', 64),
    '8c000000-0000-4000-8000-000000000001',
    'ctm_' || repeat('c', 26),
    'sub_' || repeat('d', 26),
    'pri_01m5ftaym9s2q2ea2etcgzrx1z',
    'trialing',
    '2026-11-04T00:00:00Z',
    '2026-11-18T00:00:00Z',
    false
  ),
  'plan_not_configured',
  'A sandbox price cannot grant a live subscription'
);

SELECT is(
  public.apply_paddle_subscription_event(
    'paddle',
    'evt_' || repeat('c', 25) || '2',
    'subscription.trialing',
    '2026-11-04T00:00:01Z',
    repeat('4', 64),
    '8c000000-0000-4000-8000-000000000001',
    'ctm_' || repeat('c', 26),
    'sub_' || repeat('d', 26),
    'pri_01m6k8spcay1tgqctewmv8jhwh',
    'trialing',
    '2026-11-04T00:00:00Z',
    '2026-11-18T00:00:00Z',
    false
  ),
  'processed',
  'A verified live trial event is applied'
);

SELECT is(
  (
    SELECT provider::text || '/' || plan_code || '/' || status::text || '/'
      || access_mode::text
    FROM public.tenant_subscriptions
    WHERE tenant_id = '8c000000-0000-4000-8000-000000000001'
  ),
  'paddle/starter_monthly/trialing/full',
  'The live trial unlocks the workspace on the Starter plan'
);

SELECT is(
  public.apply_paddle_sandbox_subscription_event(
    'evt_' || repeat('e', 25) || '0',
    'subscription.activated',
    '2026-11-04T00:00:00Z',
    repeat('5', 64),
    '8c000000-0000-4000-8000-000000000002',
    'ctm_' || repeat('e', 26),
    'sub_' || repeat('f', 26),
    'pri_01m5ftaym9s2q2ea2etcgzrx1z',
    'active',
    '2026-11-04T00:00:00Z',
    '2026-12-04T00:00:00Z',
    false
  ),
  'processed',
  'The sandbox webhook entry point still works'
);

SELECT is(
  (
    SELECT provider::text || '/' || plan_code
    FROM public.tenant_subscriptions
    WHERE tenant_id = '8c000000-0000-4000-8000-000000000002'
  ),
  'paddle_sandbox/starter_monthly_sandbox',
  'Sandbox events still map to the sandbox catalog'
);

SELECT is(
  ARRAY(
    SELECT tenant_id::text
    FROM public.list_paddle_subscriptions_for_reconciliation('paddle', 50)
  ),
  ARRAY['8c000000-0000-4000-8000-000000000001'],
  'Live reconciliation lists only live subscriptions'
);

SELECT is(
  public.apply_paddle_reconciliation_snapshot(
    'paddle',
    '8c000000-0000-4000-8000-000000000001',
    'ctm_' || repeat('c', 26),
    'sub_' || repeat('d', 26),
    'pri_01m6k8spcay1tgqctewmv8jhwh',
    'canceled',
    NULL,
    NULL,
    false,
    '2026-11-20T00:00:00Z'
  ),
  'updated',
  'Live reconciliation applies a provider cancellation'
);

SELECT lives_ok(
  $$SELECT public.finish_paddle_reconciliation(
    'paddle',
    public.begin_paddle_reconciliation('paddle'),
    'succeeded', 1, 1, 0, NULL
  )$$,
  'A live reconciliation run can be recorded'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"8b000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT ok(
  public.get_current_tenant_requires_checkout(),
  'A canceled subscription asks the owner to choose a plan again'
);

SELECT * FROM finish();
ROLLBACK;
