BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(9);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '12000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'quotes-owner@crewflow.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
);

INSERT INTO public.tenants (
  id, legal_name, display_name, business_email, time_zone,
  service_categories, tax_rate_bps
) VALUES (
  '22000000-0000-4000-8000-000000000001', 'Quotes Tenant LLC',
  'Quotes Tenant', 'quotes@crewflow.test', 'America/Chicago', ARRAY['HVAC'], 825
);

INSERT INTO public.memberships (id, tenant_id, user_id, role, status, joined_at)
VALUES (
  '32000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001', 'owner', 'active', now()
);

INSERT INTO public.customers (id, tenant_id, first_name, last_name, postal_code)
VALUES (
  '52000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001', 'Quote', 'Customer', '78701'
);

INSERT INTO public.jobs (id, tenant_id, customer_id, title)
VALUES (
  '62000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  '52000000-0000-4000-8000-000000000001', 'Quoted repair'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"12000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

SELECT lives_ok(
  $$SELECT public.save_job_quote(
    '62000000-0000-4000-8000-000000000001',
    '[{"description":"Repair labor","quantity":2,"unit_price_cents":10000,"taxable":true}]'::jsonb,
    1000,
    now() + interval '14 days'
  )$$,
  'Owner can save a tenant-scoped draft quote'
);

SELECT is(
  (SELECT total_cents FROM public.quotes WHERE job_id = '62000000-0000-4000-8000-000000000001'),
  20568,
  'Database calculates proportional discount tax and quote total'
);
SELECT is(
  (SELECT count(*) FROM public.quote_line_items),
  1::bigint,
  'Owner can read the saved immutable line snapshot'
);

SELECT set_config(
  'crewflow.quote_token',
  public.publish_job_quote(
    (SELECT id FROM public.quotes WHERE job_id = '62000000-0000-4000-8000-000000000001')
  ),
  true
);

SELECT is(
  char_length(current_setting('crewflow.quote_token')),
  64,
  'Publishing returns a 256-bit hex token once'
);
SELECT isnt(
  (SELECT decision_token_hash FROM public.quotes WHERE job_id = '62000000-0000-4000-8000-000000000001'),
  current_setting('crewflow.quote_token'),
  'Only the token hash is stored'
);

RESET ROLE;
SET LOCAL ROLE anon;

SELECT is(
  public.get_public_quote(current_setting('crewflow.quote_token'))->>'status',
  'sent',
  'Anonymous customer can read only the token-scoped public projection'
);
SELECT is(
  public.decide_public_quote(current_setting('crewflow.quote_token'), 'accepted'),
  'accepted',
  'Anonymous customer can accept an unexpired sent quote once'
);
SELECT throws_ok(
  $$SELECT public.decide_public_quote(current_setting('crewflow.quote_token'), 'declined')$$,
  '22023',
  'quote is unavailable or already decided',
  'The same customer token cannot decide twice'
);

RESET ROLE;
SELECT is(
  (SELECT status::text FROM public.jobs WHERE id = '62000000-0000-4000-8000-000000000001'),
  'accepted',
  'Accepted quote advances the guarded job lifecycle'
);

SELECT * FROM finish();

ROLLBACK;
