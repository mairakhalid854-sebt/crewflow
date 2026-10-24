BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(11);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '13000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'invoice-owner@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '13000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'invoice-tech@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

INSERT INTO public.tenants (
  id, legal_name, display_name, business_email, time_zone,
  service_categories, tax_rate_bps
) VALUES (
  '23000000-0000-4000-8000-000000000001', 'Invoice Tenant LLC',
  'Invoice Tenant', 'invoice@crewflow.test', 'America/Chicago', ARRAY['HVAC'], 825
);

INSERT INTO public.memberships (id, tenant_id, user_id, role, status, joined_at)
VALUES
  (
    '33000000-0000-4000-8000-000000000001',
    '23000000-0000-4000-8000-000000000001',
    '13000000-0000-4000-8000-000000000001', 'owner', 'active', now()
  ),
  (
    '33000000-0000-4000-8000-000000000002',
    '23000000-0000-4000-8000-000000000001',
    '13000000-0000-4000-8000-000000000002', 'technician', 'active', now()
  );

INSERT INTO public.staff_availability (
  tenant_id, membership_id, day_of_week, is_available, starts_at, ends_at
) VALUES (
  '23000000-0000-4000-8000-000000000001',
  '33000000-0000-4000-8000-000000000002', 2, true, '00:00', '23:59'
);

INSERT INTO public.customers (id, tenant_id, first_name, last_name, postal_code)
VALUES (
  '53000000-0000-4000-8000-000000000001',
  '23000000-0000-4000-8000-000000000001', 'Invoice', 'Customer', '78701'
);

INSERT INTO public.jobs (
  id, tenant_id, customer_id, assigned_membership_id, title,
  scheduled_start_at, scheduled_end_at
) VALUES (
  '63000000-0000-4000-8000-000000000001',
  '23000000-0000-4000-8000-000000000001',
  '53000000-0000-4000-8000-000000000001',
  '33000000-0000-4000-8000-000000000002', 'Completed repair',
  '2026-10-20T15:00:00Z', '2026-10-20T16:00:00Z'
);

UPDATE public.jobs SET status = 'quoted' WHERE id = '63000000-0000-4000-8000-000000000001';
UPDATE public.jobs SET status = 'accepted' WHERE id = '63000000-0000-4000-8000-000000000001';
UPDATE public.jobs SET status = 'scheduled' WHERE id = '63000000-0000-4000-8000-000000000001';
UPDATE public.jobs SET status = 'in_progress' WHERE id = '63000000-0000-4000-8000-000000000001';
UPDATE public.jobs SET status = 'completed' WHERE id = '63000000-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"13000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

SELECT lives_ok(
  $$SELECT public.save_job_invoice(
    '63000000-0000-4000-8000-000000000001',
    '[{"description":"Repair labor","quantity":2,"unit_price_cents":10000,"taxable":true}]'::jsonb,
    1000,
    now() + interval '14 days',
    'https://pay.example.com/invoice/1'
  )$$,
  'Owner can save an invoice for a completed tenant job'
);

SELECT is((SELECT invoice_number FROM public.invoices), 1::bigint, 'Tenant invoice numbering starts at one');
SELECT is((SELECT total_cents FROM public.invoices), 20568::bigint, 'Database calculates invoice tax and total');

SELECT set_config(
  'crewflow.invoice_token',
  public.publish_job_invoice((SELECT id FROM public.invoices)),
  true
);
SELECT is(char_length(current_setting('crewflow.invoice_token')), 64, 'Publishing returns a 256-bit token once');

RESET ROLE;
SET LOCAL ROLE anon;
SELECT is(
  public.get_public_invoice(current_setting('crewflow.invoice_token'))->>'status',
  'sent',
  'Anonymous customer can read the token-scoped invoice'
);

RESET ROLE;
SELECT is(
  (SELECT paid_cents FROM public.invoices),
  0::bigint,
  'Reading or clicking the external link does not record payment'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"13000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT lives_ok(
  $$SELECT public.record_manual_invoice_payment(
    (SELECT id FROM public.invoices), 10000, 'cash', 'receipt-1', '', now()
  )$$,
  'Owner can record a verified partial manual payment'
);
SELECT is((SELECT status::text FROM public.invoices), 'partially_paid', 'Partial payment has an explicit status');
SELECT lives_ok(
  $$SELECT public.record_manual_invoice_payment(
    (SELECT id FROM public.invoices), 10568, 'external_transfer', 'bank-2', '', now()
  )$$,
  'Remaining verified payment can be recorded'
);
SELECT is((SELECT status::text FROM public.invoices), 'paid', 'Full recorded balance marks invoice paid');
SELECT throws_ok(
  $$SELECT public.record_manual_invoice_payment(
    (SELECT id FROM public.invoices), 1, 'cash', '', '', now()
  )$$,
  '42501',
  'invoice is unavailable for payment recording',
  'Paid invoice rejects duplicate payment records'
);

SELECT * FROM finish();
ROLLBACK;
