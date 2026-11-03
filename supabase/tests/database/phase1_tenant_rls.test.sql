BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(12);

SELECT is(
  (
    SELECT count(*)
    FROM pg_class
    JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    WHERE pg_namespace.nspname = 'public'
      AND pg_class.relname = ANY (ARRAY[
        'tenants',
        'memberships',
        'tenant_settings',
        'business_hours',
        'services',
        'customers',
        'audit_events'
      ])
      AND pg_class.relrowsecurity
  ),
  7::bigint,
  'RLS is enabled on every tenant-owned Phase 1 table'
);

INSERT INTO auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'owner-a@crewflow.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'owner-b@crewflow.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'technician-a@crewflow.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

INSERT INTO public.tenants (
  id,
  legal_name,
  display_name,
  business_email,
  time_zone,
  service_categories
)
VALUES
  (
    '20000000-0000-4000-8000-000000000001',
    'Tenant A LLC',
    'Tenant A',
    'office-a@crewflow.test',
    'America/New_York',
    ARRAY['HVAC']
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'Tenant B LLC',
    'Tenant B',
    'office-b@crewflow.test',
    'America/Chicago',
    ARRAY['Plumbing']
  );

INSERT INTO public.memberships (
  id,
  tenant_id,
  user_id,
  role,
  status,
  joined_at
)
VALUES
  (
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'owner',
    'active',
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'owner',
    'active',
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003',
    'technician',
    'active',
    now()
  );

INSERT INTO public.services (
  id,
  tenant_id,
  name,
  unit_price_cents,
  default_duration_minutes
)
VALUES
  (
    '40000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'Tenant A service',
    10000,
    60
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    'Tenant B service',
    12000,
    90
  );

INSERT INTO public.customers (id, tenant_id, first_name, last_name)
VALUES
  (
    '50000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'Customer',
    'Alpha'
  ),
  (
    '50000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    'Customer',
    'Beta'
  );

INSERT INTO public.audit_events (tenant_id, actor_user_id, action, entity_type)
VALUES
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'test.created',
    'test'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'test.created',
    'test'
  );

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

SELECT is(
  (SELECT count(*) FROM public.tenants),
  1::bigint,
  'Owner sees only their tenant'
);

SELECT is(
  (SELECT count(*) FROM public.customers),
  1::bigint,
  'Owner sees only customers in their tenant'
);

SELECT is(
  (SELECT count(*) FROM public.services),
  1::bigint,
  'Owner sees only services in their tenant'
);

SELECT lives_ok(
  $$
    INSERT INTO public.customers (tenant_id, first_name, last_name)
    VALUES ('20000000-0000-4000-8000-000000000001', 'Allowed', 'Customer')
  $$,
  'Owner can insert a customer in their tenant'
);

SELECT throws_ok(
  $$
    INSERT INTO public.customers (tenant_id, first_name, last_name)
    VALUES ('20000000-0000-4000-8000-000000000002', 'Blocked', 'Customer')
  $$,
  '42501',
  'new row violates row-level security policy for table "customers"',
  'Owner cannot insert a customer in another tenant'
);

SELECT is(
  (SELECT count(DISTINCT tenant_id) FROM public.audit_events),
  1::bigint,
  'Owner sees only audit events in their tenant'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);

SELECT is(
  (SELECT count(*) FROM public.services),
  1::bigint,
  'Technician sees services only in their tenant'
);

SELECT is(
  (SELECT count(*) FROM public.customers),
  0::bigint,
  'Technician cannot read customer records'
);

SELECT throws_ok(
  $$
    INSERT INTO public.customers (tenant_id, first_name, last_name)
    VALUES ('20000000-0000-4000-8000-000000000001', 'Blocked', 'Technician')
  $$,
  '42501',
  'new row violates row-level security policy for table "customers"',
  'Technician cannot insert customers'
);

SELECT throws_ok(
  $$
    INSERT INTO public.audit_events (tenant_id, action, entity_type)
    VALUES ('20000000-0000-4000-8000-000000000001', 'blocked', 'test')
  $$,
  '42501',
  'permission denied for table audit_events',
  'Authenticated clients cannot write audit events directly'
);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok(
  'SELECT count(*) FROM public.tenants',
  '42501',
  'permission denied for table tenants',
  'Anonymous users have no tenant table grants'
);

SELECT * FROM finish();

ROLLBACK;
