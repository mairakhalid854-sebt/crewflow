BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(9);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '1c000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'review-owner@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '1c000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'review-tech@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

INSERT INTO public.tenants (
  id, legal_name, display_name, business_email, time_zone,
  service_categories, tax_rate_bps
) VALUES (
  '2c000000-0000-4000-8000-000000000001', 'Review Tenant LLC',
  'Review Tenant', 'review@crewflow.test', 'America/Chicago', ARRAY['HVAC'], 825
);

INSERT INTO public.memberships (id, tenant_id, user_id, role, status, joined_at)
VALUES
  (
    '3c000000-0000-4000-8000-000000000001',
    '2c000000-0000-4000-8000-000000000001',
    '1c000000-0000-4000-8000-000000000001', 'owner', 'active', now()
  ),
  (
    '3c000000-0000-4000-8000-000000000002',
    '2c000000-0000-4000-8000-000000000001',
    '1c000000-0000-4000-8000-000000000002', 'technician', 'active', now()
  );

INSERT INTO public.staff_availability (
  tenant_id, membership_id, day_of_week, is_available, starts_at, ends_at
) VALUES (
  '2c000000-0000-4000-8000-000000000001',
  '3c000000-0000-4000-8000-000000000002', 2, true, '00:00', '23:59'
);

INSERT INTO public.customers (id, tenant_id, first_name, last_name, postal_code)
VALUES (
  '5c000000-0000-4000-8000-000000000001',
  '2c000000-0000-4000-8000-000000000001', 'Invoice', 'Customer', '78701'
);

INSERT INTO public.jobs (
  id, tenant_id, customer_id, assigned_membership_id, title,
  scheduled_start_at, scheduled_end_at
) VALUES (
  '6c000000-0000-4000-8000-000000000001',
  '2c000000-0000-4000-8000-000000000001',
  '5c000000-0000-4000-8000-000000000001',
  '3c000000-0000-4000-8000-000000000002', 'Completed repair',
  '2026-10-20T15:00:00Z', '2026-10-20T16:00:00Z'
);

UPDATE public.jobs SET status = 'quoted' WHERE id = '6c000000-0000-4000-8000-000000000001';
UPDATE public.jobs SET status = 'accepted' WHERE id = '6c000000-0000-4000-8000-000000000001';
UPDATE public.jobs SET status = 'scheduled' WHERE id = '6c000000-0000-4000-8000-000000000001';
UPDATE public.jobs SET status = 'in_progress' WHERE id = '6c000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"1c000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

SELECT lives_ok(
  $$UPDATE public.tenant_settings
    SET google_review_url = 'https://g.page/r/CrewFlowReview123/review'
    WHERE tenant_id = '2c000000-0000-4000-8000-000000000001'$$,
  'Owner can save a Google review link once in settings'
);

SELECT throws_ok(
  $$UPDATE public.tenant_settings
    SET google_review_url = 'https://evil.example.com/review'
    WHERE tenant_id = '2c000000-0000-4000-8000-000000000001'$$,
  '23514',
  NULL,
  'A non-Google link is rejected'
);

SELECT throws_ok(
  $$UPDATE public.tenant_settings
    SET google_review_url = 'http://g.page/r/CrewFlowReview123/review'
    WHERE tenant_id = '2c000000-0000-4000-8000-000000000001'$$,
  '23514',
  NULL,
  'A plain HTTP link is rejected'
);

SELECT throws_ok(
  $$UPDATE public.tenant_settings
    SET google_review_url = 'https://g.page.evil.com/r/x'
    WHERE tenant_id = '2c000000-0000-4000-8000-000000000001'$$,
  '23514',
  NULL,
  'A look-alike Google host is rejected'
);

SELECT lives_ok(
  $$SELECT public.save_job_invoice(
    '6c000000-0000-4000-8000-000000000001',
    '[{"description":"Repair labor","quantity":1,"unit_price_cents":10000,"taxable":true}]'::jsonb,
    0,
    now() + interval '14 days',
    NULL
  )$$,
  'Owner can save an invoice'
);

SELECT set_config(
  'crewflow.review_invoice_token',
  public.publish_job_invoice((SELECT id FROM public.invoices WHERE tenant_id = '2c000000-0000-4000-8000-000000000001')),
  true
);

RESET ROLE;
SELECT is(
  (SELECT count(*)::integer FROM public.audit_events
   WHERE tenant_id = '2c000000-0000-4000-8000-000000000001'
     AND action = 'settings.google_review_link_saved'),
  1,
  'Saving the review link is recorded in the audit trail'
);

SET LOCAL ROLE anon;
SELECT is(
  public.get_public_invoice(current_setting('crewflow.review_invoice_token'))->>'google_review_url',
  'https://g.page/r/CrewFlowReview123/review',
  'Every sent invoice carries the saved Google review link'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"1c000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT lives_ok(
  $$SELECT public.void_invoice(
    (SELECT id FROM public.invoices WHERE tenant_id = '2c000000-0000-4000-8000-000000000001'),
    'Created by mistake'
  )$$,
  'Owner can void the invoice'
);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT ok(
  public.get_public_invoice(current_setting('crewflow.review_invoice_token'))->'google_review_url' = 'null'::jsonb,
  'A void invoice never asks for a review'
);

SELECT * FROM finish();
ROLLBACK;
