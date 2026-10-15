BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(10);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('11000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'jobs-owner-a@crewflow.test', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('11000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'jobs-owner-b@crewflow.test', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('11000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'jobs-tech-a@crewflow.test', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.tenants (id, legal_name, display_name, business_email, time_zone, service_categories)
VALUES
  ('21000000-0000-4000-8000-000000000001', 'Jobs Tenant A LLC', 'Jobs Tenant A', 'jobs-a@crewflow.test', 'America/New_York', ARRAY['HVAC']),
  ('21000000-0000-4000-8000-000000000002', 'Jobs Tenant B LLC', 'Jobs Tenant B', 'jobs-b@crewflow.test', 'America/Chicago', ARRAY['Plumbing']);

INSERT INTO public.memberships (id, tenant_id, user_id, role, status, joined_at)
VALUES
  ('31000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'owner', 'active', now()),
  ('31000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000002', 'owner', 'active', now()),
  ('31000000-0000-4000-8000-000000000003', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000003', 'technician', 'active', now());

INSERT INTO public.customers (id, tenant_id, first_name, last_name, postal_code)
VALUES
  ('51000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'Jobs', 'Alpha', '78701'),
  ('51000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000002', 'Jobs', 'Beta', '60601'),
  ('51000000-0000-4000-8000-000000000003', '21000000-0000-4000-8000-000000000001', 'Jobs', 'Covered', '78701-1234'),
  ('51000000-0000-4000-8000-000000000004', '21000000-0000-4000-8000-000000000001', 'Jobs', 'Outside', '90210'),
  ('51000000-0000-4000-8000-000000000005', '21000000-0000-4000-8000-000000000001', 'Jobs', 'Missing', NULL);

INSERT INTO public.jobs (
  id, tenant_id, customer_id, assigned_membership_id, title,
  scheduled_start_at, scheduled_end_at
)
VALUES
  ('61000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000003', 'Assigned job', '2026-10-20T14:00:00Z', '2026-10-20T15:00:00Z'),
  ('61000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', NULL, 'Unassigned job', NULL, NULL),
  ('61000000-0000-4000-8000-000000000003', '21000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000002', NULL, 'Other tenant job', NULL, NULL),
  ('61000000-0000-4000-8000-000000000004', '21000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000003', NULL, 'Covered service-area job', NULL, NULL),
  ('61000000-0000-4000-8000-000000000005', '21000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000004', NULL, 'Outside service-area job', NULL, NULL),
  ('61000000-0000-4000-8000-000000000006', '21000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000005', NULL, 'Missing ZIP job', NULL, NULL);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

SELECT is((SELECT count(*) FROM public.jobs), 5::bigint, 'Owner sees only jobs in their tenant');
SELECT lives_ok(
  $$INSERT INTO public.jobs (tenant_id, customer_id, title) VALUES ('21000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'Allowed owner job')$$,
  'Owner can create a job in their tenant'
);
SELECT throws_ok(
  $$INSERT INTO public.jobs (tenant_id, customer_id, title) VALUES ('21000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000002', 'Blocked owner job')$$,
  '42501',
  'new row violates row-level security policy for table "jobs"',
  'Owner cannot create a job in another tenant'
);

UPDATE public.staff_profiles
SET service_area_postal_codes = ARRAY['78701']
WHERE membership_id = '31000000-0000-4000-8000-000000000003';

SELECT lives_ok(
  $$UPDATE public.jobs SET assigned_membership_id = '31000000-0000-4000-8000-000000000003' WHERE id = '61000000-0000-4000-8000-000000000004'$$,
  'Owner can assign a ZIP+4 job covered by a five-digit technician service area'
);
SELECT throws_ok(
  $$UPDATE public.jobs SET assigned_membership_id = '31000000-0000-4000-8000-000000000003' WHERE id = '61000000-0000-4000-8000-000000000005'$$,
  '22023',
  'technician service area does not cover the customer postal code',
  'Owner cannot assign a technician outside their configured service area'
);
SELECT throws_ok(
  $$UPDATE public.jobs SET assigned_membership_id = '31000000-0000-4000-8000-000000000003' WHERE id = '61000000-0000-4000-8000-000000000006'$$,
  '22023',
  'customer postal code is required to validate technician service area',
  'Owner must add a customer ZIP before applying configured service-area rules'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

SELECT is((SELECT count(*) FROM public.jobs), 2::bigint, 'Technician sees only their assigned jobs');
SELECT is((SELECT count(*) FROM public.customers), 2::bigint, 'Technician sees only customers for assigned jobs');
SELECT is(
  (
    WITH updated_job AS (
      UPDATE public.jobs
      SET title = 'Blocked technician edit'
      WHERE id = '61000000-0000-4000-8000-000000000001'
      RETURNING id
    )
    SELECT count(*) FROM updated_job
  ),
  0::bigint,
  'Technician cannot update an assigned job'
);
SELECT throws_ok(
  $$INSERT INTO public.jobs (tenant_id, customer_id, title) VALUES ('21000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'Blocked technician job')$$,
  '42501',
  'new row violates row-level security policy for table "jobs"',
  'Technician cannot create jobs'
);

SELECT * FROM finish();

ROLLBACK;
