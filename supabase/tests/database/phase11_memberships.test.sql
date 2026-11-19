BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(27);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('11000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'plan-owner@crewflow.test', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('11000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'plan-other@crewflow.test', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('11000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'plan-tech@crewflow.test', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('11000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'plan-office@crewflow.test', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.tenants (
  id, legal_name, display_name, business_email, time_zone, service_categories
) VALUES
  ('22000000-0000-4000-8000-000000000001', 'Plan Co LLC', 'Plan Co',
   'office@plan.test', 'America/New_York', ARRAY['HVAC']),
  ('22000000-0000-4000-8000-000000000002', 'Other LLC', 'Other',
   'other@plan.test', 'America/Chicago', ARRAY['HVAC']);

UPDATE public.tenant_subscriptions SET access_mode = 'full'
WHERE tenant_id IN (
  '22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000002'
);

INSERT INTO public.memberships (id, tenant_id, user_id, role, status, joined_at)
VALUES
  ('33000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001',
   '11000000-0000-4000-8000-000000000001', 'owner', 'active', now()),
  ('33000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000002',
   '11000000-0000-4000-8000-000000000002', 'owner', 'active', now()),
  ('33000000-0000-4000-8000-000000000003', '22000000-0000-4000-8000-000000000001',
   '11000000-0000-4000-8000-000000000003', 'technician', 'active', now()),
  ('33000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-000000000001',
   '11000000-0000-4000-8000-000000000004', 'office', 'active', now());

INSERT INTO public.services (
  id, tenant_id, name, unit_price_cents, default_duration_minutes
) VALUES (
  '66000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001',
  'AC tune-up', 12900, 60
);

INSERT INTO public.customers (id, tenant_id, first_name, last_name, email)
VALUES
  ('44000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001',
   'Ana', 'Lopez', 'ana@example.com'),
  ('44000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000001',
   'Ben', 'Diaz', 'ben@example.com'),
  ('44000000-0000-4000-8000-000000000003', '22000000-0000-4000-8000-000000000002',
   'Other', 'Customer', 'other@example.com');

SELECT has_table('public', 'membership_plans', 'membership_plans exists');
SELECT has_table('public', 'customer_memberships', 'customer_memberships exists');
SELECT has_table('public', 'membership_visits', 'membership_visits exists');
SELECT ok(
  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crewflow-membership-visits-daily'),
  'the daily visit scheduler is registered'
);

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.save_membership_plan('22000000-0000-4000-8000-000000000001', NULL,
    'Comfort Club', NULL, 1500, 'monthly', 2, 10,
    '66000000-0000-4000-8000-000000000001', true)$$,
  '42501', NULL, 'office staff cannot create plans'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.save_membership_plan('22000000-0000-4000-8000-000000000001', NULL,
    'Odd Plan', NULL, 1500, 'monthly', 5, 10, NULL, true)$$,
  '23514', NULL, 'visit counts that do not divide the year are refused'
);
SELECT throws_ok(
  $$SELECT public.save_membership_plan('22000000-0000-4000-8000-000000000001', NULL,
    'Greedy Plan', NULL, 1500, 'monthly', 2, 80, NULL, true)$$,
  '23514', NULL, 'discounts over 50 percent are refused'
);
SELECT set_config('crewflow.plan', public.save_membership_plan(
  '22000000-0000-4000-8000-000000000001', NULL, 'Comfort Club',
  'Two tune-ups a year and 10% off repairs.', 1500, 'monthly', 2, 10,
  '66000000-0000-4000-8000-000000000001', true)::text, true);
SELECT is(
  (SELECT name FROM public.membership_plans
   WHERE id = current_setting('crewflow.plan')::uuid),
  'Comfort Club',
  'the owner creates a plan'
);
SELECT is(
  public.save_membership_plan('22000000-0000-4000-8000-000000000001',
    current_setting('crewflow.plan')::uuid, 'Comfort Club', NULL, 1800,
    'monthly', 2, 10, '66000000-0000-4000-8000-000000000001', true)::text,
  current_setting('crewflow.plan'),
  'the owner updates the plan'
);
SELECT set_config('crewflow.yearly', public.save_membership_plan(
  '22000000-0000-4000-8000-000000000001', NULL, 'Yearly Care', NULL, 19900,
  'yearly', 1, 15, NULL, true)::text, true);
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Enrollments
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.enroll_customer_membership('44000000-0000-4000-8000-000000000001',
    current_setting('crewflow.plan')::uuid, current_date, current_date)$$,
  '42501', NULL, 'technicians cannot enroll customers'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
SELECT set_config('crewflow.ana', public.enroll_customer_membership(
  '44000000-0000-4000-8000-000000000001', current_setting('crewflow.plan')::uuid,
  current_date, current_date + 3)::text, true);
SELECT is(
  (SELECT row(plan_name, price_cents, visits_per_year, discount_percent,
      renews_on = (current_date + interval '1 month')::date)::text
   FROM public.customer_memberships WHERE id = current_setting('crewflow.ana')::uuid),
  row('Comfort Club', 1800, 2, 10, true)::text,
  'office staff enroll a customer with a snapshot of the plan'
);
SELECT throws_ok(
  $$SELECT public.enroll_customer_membership('44000000-0000-4000-8000-000000000001',
    current_setting('crewflow.plan')::uuid, current_date, current_date)$$,
  '23505', 'customer already has this plan', 'a customer cannot join the same plan twice'
);
SELECT throws_ok(
  $$SELECT public.enroll_customer_membership('44000000-0000-4000-8000-000000000003',
    current_setting('crewflow.plan')::uuid, current_date, current_date)$$,
  '42501', NULL, 'customers of another business cannot be enrolled'
);
SELECT set_config('crewflow.ben', public.enroll_customer_membership(
  '44000000-0000-4000-8000-000000000002', current_setting('crewflow.yearly')::uuid,
  current_date, current_date + 60)::text, true);
SELECT is(
  (SELECT renews_on FROM public.customer_memberships
   WHERE id = current_setting('crewflow.ben')::uuid),
  (current_date + interval '1 year')::date,
  'yearly plans renew a year later'
);
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Scheduler
-- ---------------------------------------------------------------------------

SELECT is(public.create_due_membership_visits(NULL), 1,
  'only the visit due within 14 days creates a job');
SELECT is(
  (SELECT row(job.status, job.service_id, job.title)::text
   FROM public.membership_visits AS visit
   JOIN public.jobs AS job ON job.id = visit.job_id
   WHERE visit.customer_membership_id = current_setting('crewflow.ana')::uuid),
  row('new'::public.job_status, '66000000-0000-4000-8000-000000000001'::uuid,
    'Comfort Club visit: AC tune-up')::text,
  'the visit job is new, unscheduled work for the plan service'
);
SELECT is(
  (SELECT next_visit_on FROM public.customer_memberships
   WHERE id = current_setting('crewflow.ana')::uuid),
  (current_date + 3 + interval '6 months')::date,
  'the next visit moves forward by the plan interval'
);
SELECT is(public.create_due_membership_visits(NULL), 0,
  'running again does not create duplicates');

UPDATE public.customer_memberships
SET renews_on = current_date - 1, started_on = current_date - 40
WHERE id = current_setting('crewflow.ana')::uuid;
SELECT lives_ok($$SELECT public.create_due_membership_visits(NULL)$$,
  'the scheduler runs with a renewal due');
SELECT is(
  (SELECT renews_on FROM public.customer_memberships
   WHERE id = current_setting('crewflow.ana')::uuid),
  (current_date - 1 + interval '1 month')::date,
  'past renewal dates roll forward'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT is((SELECT count(*) FROM public.customer_memberships)::integer, 0,
  'another business cannot see these memberships');
SELECT throws_ok(
  $$SELECT public.create_my_due_membership_visits('22000000-0000-4000-8000-000000000001')$$,
  '42501', NULL, 'another business cannot run this business''s visits'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
SELECT is(public.create_my_due_membership_visits('22000000-0000-4000-8000-000000000001'),
  0, 'office staff can run the visit check on demand');

-- ---------------------------------------------------------------------------
-- Cancelling
-- ---------------------------------------------------------------------------

SELECT throws_ok(
  $$SELECT public.cancel_customer_membership(current_setting('crewflow.ben')::uuid, '')$$,
  '22023', 'reason required', 'a cancel reason is required'
);
SELECT is(
  public.cancel_customer_membership(current_setting('crewflow.ben')::uuid,
    'Moving out of state'),
  'cancelled',
  'office staff cancel a membership'
);
RESET ROLE;

UPDATE public.customer_memberships SET next_visit_on = current_date
WHERE id = current_setting('crewflow.ben')::uuid;
SELECT is(public.create_due_membership_visits(NULL), 0,
  'cancelled memberships get no new visits');

UPDATE public.customer_memberships SET next_visit_on = current_date
WHERE id = current_setting('crewflow.ana')::uuid;
UPDATE public.tenant_subscriptions SET status = 'canceled', access_mode = 'read_only'
WHERE tenant_id = '22000000-0000-4000-8000-000000000001';
SELECT is(public.create_due_membership_visits(NULL), 0,
  'read-only workspaces get no new visits');

SELECT * FROM finish();
ROLLBACK;
