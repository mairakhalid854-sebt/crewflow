BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(13);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '11000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'follow-owner@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '11000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'other-owner@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '11000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
    'follow-tech@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

INSERT INTO public.tenants (
  id, legal_name, display_name, business_email, time_zone, service_categories
) VALUES
  (
    '22000000-0000-4000-8000-000000000001', 'Follow Up LLC', 'Follow Up',
    'office@follow-up.test', 'America/New_York', ARRAY['Cleaning']
  ),
  (
    '22000000-0000-4000-8000-000000000002', 'Other LLC', 'Other',
    'other@follow-up.test', 'America/Chicago', ARRAY['HVAC']
  );

INSERT INTO public.tenant_settings (tenant_id, ai_operations_enabled, ai_monthly_budget_cents)
VALUES
  ('22000000-0000-4000-8000-000000000001', true, 1000),
  ('22000000-0000-4000-8000-000000000002', true, 1000);

INSERT INTO public.memberships (id, tenant_id, user_id, role, status, joined_at)
VALUES
  (
    '33000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001', 'owner', 'active', now()
  ),
  (
    '33000000-0000-4000-8000-000000000002',
    '22000000-0000-4000-8000-000000000002',
    '11000000-0000-4000-8000-000000000002', 'owner', 'active', now()
  ),
  (
    '33000000-0000-4000-8000-000000000003',
    '22000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000003', 'technician', 'active', now()
  );

INSERT INTO public.staff_availability (
  tenant_id, membership_id, day_of_week, is_available, starts_at, ends_at
) VALUES (
  '22000000-0000-4000-8000-000000000001',
  '33000000-0000-4000-8000-000000000003',
  2, true, '08:00', '18:00'
);

INSERT INTO public.customers (
  id, tenant_id, first_name, last_name, email,
  transactional_email_allowed, marketing_email_opted_in
) VALUES
  (
    '44000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    'Reminder', 'Customer', 'reminder@example.com', true, false
  ),
  (
    '44000000-0000-4000-8000-000000000002',
    '22000000-0000-4000-8000-000000000001',
    'Review', 'Customer', 'review@example.com', true, true
  ),
  (
    '44000000-0000-4000-8000-000000000003',
    '22000000-0000-4000-8000-000000000001',
    'Suppressed', 'Customer', 'suppressed@example.com', true, true
  );

UPDATE public.customers
SET email_suppressed_at = '2026-10-20T15:00:00Z',
    email_suppression_reason = 'Customer requested suppression.'
WHERE id = '44000000-0000-4000-8000-000000000003';

INSERT INTO public.jobs (
  id, tenant_id, customer_id, title
) VALUES
  (
    '55000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000001', 'Reminder job'
  ),
  (
    '55000000-0000-4000-8000-000000000002',
    '22000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000002', 'Review job'
  ),
  (
    '55000000-0000-4000-8000-000000000003',
    '22000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000003', 'Suppressed job'
  ),
  (
    '55000000-0000-4000-8000-000000000004',
    '22000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000001', 'Void job'
  );

UPDATE public.jobs SET status = 'quoted'
WHERE tenant_id = '22000000-0000-4000-8000-000000000001';
UPDATE public.jobs SET status = 'accepted'
WHERE tenant_id = '22000000-0000-4000-8000-000000000001';
UPDATE public.jobs
SET status = 'scheduled',
    assigned_membership_id = '33000000-0000-4000-8000-000000000003',
    scheduled_start_at = CASE id
      WHEN '55000000-0000-4000-8000-000000000001' THEN '2026-10-20T14:00:00Z'::timestamptz
      WHEN '55000000-0000-4000-8000-000000000002' THEN '2026-10-20T15:00:00Z'::timestamptz
      WHEN '55000000-0000-4000-8000-000000000003' THEN '2026-10-20T16:00:00Z'::timestamptz
      ELSE '2026-10-20T17:00:00Z'::timestamptz
    END,
    scheduled_end_at = CASE id
      WHEN '55000000-0000-4000-8000-000000000001' THEN '2026-10-20T15:00:00Z'::timestamptz
      WHEN '55000000-0000-4000-8000-000000000002' THEN '2026-10-20T16:00:00Z'::timestamptz
      WHEN '55000000-0000-4000-8000-000000000003' THEN '2026-10-20T17:00:00Z'::timestamptz
      ELSE '2026-10-20T18:00:00Z'::timestamptz
    END
WHERE tenant_id = '22000000-0000-4000-8000-000000000001';
UPDATE public.jobs SET status = 'in_progress'
WHERE tenant_id = '22000000-0000-4000-8000-000000000001';
UPDATE public.jobs SET status = 'completed'
WHERE tenant_id = '22000000-0000-4000-8000-000000000001';

INSERT INTO public.invoices (
  id, tenant_id, job_id, customer_id, invoice_number, status,
  subtotal_cents, discount_cents, tax_rate_bps, tax_cents, total_cents,
  paid_cents, due_at, voided_at, void_reason
) VALUES
  (
    '66000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    '55000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000001', 1, 'partially_paid',
    12500, 0, 0, 0, 12500, 2500, '2026-10-22T15:00:00Z', NULL, NULL
  ),
  (
    '66000000-0000-4000-8000-000000000002',
    '22000000-0000-4000-8000-000000000001',
    '55000000-0000-4000-8000-000000000002',
    '44000000-0000-4000-8000-000000000002', 2, 'paid',
    20000, 0, 0, 0, 20000, 20000, '2026-10-10T15:00:00Z', NULL, NULL
  ),
  (
    '66000000-0000-4000-8000-000000000003',
    '22000000-0000-4000-8000-000000000001',
    '55000000-0000-4000-8000-000000000003',
    '44000000-0000-4000-8000-000000000003', 3, 'sent',
    10000, 0, 0, 0, 10000, 0, '2026-10-22T15:00:00Z', NULL, NULL
  ),
  (
    '66000000-0000-4000-8000-000000000004',
    '22000000-0000-4000-8000-000000000001',
    '55000000-0000-4000-8000-000000000004',
    '44000000-0000-4000-8000-000000000001', 4, 'void',
    10000, 0, 0, 0, 10000, 0, '2026-10-22T15:00:00Z',
    '2026-10-24T15:00:00Z', 'Voided for integration test.'
  );

INSERT INTO public.payment_records (
  tenant_id, invoice_id, record_type, amount_cents, method, source,
  received_at, recorded_by_user_id
) VALUES
  (
    '22000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000001',
    'payment', 2500, 'cash', 'manual', '2026-10-20T15:00:00Z',
    '11000000-0000-4000-8000-000000000001'
  ),
  (
    '22000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000002',
    'payment', 20000, 'external_transfer', 'provider_confirmed',
    '2026-10-23T15:00:00Z',
    '11000000-0000-4000-8000-000000000001'
  );


-- Technician works every day so future test appointments are valid.
INSERT INTO public.staff_availability (
  tenant_id, membership_id, day_of_week, is_available, starts_at, ends_at
)
SELECT '22000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000003', day, true, '07:00', '20:00'
FROM generate_series(0, 6) AS day
WHERE day <> 2;

UPDATE public.customers SET preferred_language = 'es' WHERE id = '44000000-0000-4000-8000-000000000001';

SELECT is(public.spanish_date('2026-11-10T15:00:00Z', 'America/New_York', true, false),
  'martes, 10 de noviembre', 'Spanish weekday and month names');
SELECT is(public.spanish_date('2026-11-10T15:00:00Z', 'America/New_York', false, true),
  '10 de noviembre de 2026', 'Spanish date with year');
SELECT is(public.spanish_time('2026-11-10T15:00:00Z', 'America/New_York'),
  '10:00 a. m.', 'Spanish morning time');
SELECT is(public.spanish_time('2026-11-10T18:30:00Z', 'America/New_York'),
  '1:30 p. m.', 'Spanish afternoon time');
SELECT throws_ok(
  $$UPDATE public.customers SET preferred_language = 'fr' WHERE id = '44000000-0000-4000-8000-000000000001'$$,
  '23514', NULL, 'Only English and Spanish are supported'
);
SELECT is((SELECT preferred_language FROM public.customers WHERE id = '44000000-0000-4000-8000-000000000002'), 'en',
  'Customers default to English');

INSERT INTO public.jobs (id, tenant_id, customer_id, title) VALUES
  ('88000000-0000-4000-8000-000000000021', '22000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001', 'Limpieza profunda'),
  ('88000000-0000-4000-8000-000000000022', '22000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000002', 'Deep clean');
UPDATE public.jobs SET status = 'quoted' WHERE id IN ('88000000-0000-4000-8000-000000000021', '88000000-0000-4000-8000-000000000022');
UPDATE public.jobs SET status = 'accepted' WHERE id IN ('88000000-0000-4000-8000-000000000021', '88000000-0000-4000-8000-000000000022');
UPDATE public.jobs
SET status = 'scheduled',
    assigned_membership_id = '33000000-0000-4000-8000-000000000003',
    scheduled_start_at = CASE id
      WHEN '88000000-0000-4000-8000-000000000021' THEN date_trunc('day', now() + interval '3 days') + interval '15 hours'
      ELSE date_trunc('day', now() + interval '3 days') + interval '18 hours' END,
    scheduled_end_at = CASE id
      WHEN '88000000-0000-4000-8000-000000000021' THEN date_trunc('day', now() + interval '3 days') + interval '16 hours'
      ELSE date_trunc('day', now() + interval '3 days') + interval '19 hours' END
WHERE id IN ('88000000-0000-4000-8000-000000000021', '88000000-0000-4000-8000-000000000022');

SELECT is(
  (SELECT subject FROM public.transactional_emails WHERE kind = 'job_scheduled' AND entity_id = '88000000-0000-4000-8000-000000000021'),
  'Su cita con Follow Up está confirmada', 'Spanish customer gets a Spanish subject'
);
SELECT ok(
  (SELECT body LIKE 'Hola Reminder:%programó "Limpieza profunda" para el %hora local de Follow Up%'
   FROM public.transactional_emails WHERE kind = 'job_scheduled' AND entity_id = '88000000-0000-4000-8000-000000000021'),
  'Spanish appointment email names the job, date, and local time'
);
SELECT ok(
  (SELECT body ~ '(a\. m\.|p\. m\.)' AND body LIKE '%Enviado por CrewFlow360 en nombre de Follow Up.'
   FROM public.transactional_emails WHERE kind = 'job_scheduled' AND entity_id = '88000000-0000-4000-8000-000000000021'),
  'Spanish email uses Spanish time and sign-off'
);
SELECT is(
  (SELECT subject FROM public.transactional_emails WHERE kind = 'job_scheduled' AND entity_id = '88000000-0000-4000-8000-000000000022'),
  'Your appointment with Follow Up is confirmed', 'English customer still gets English'
);

INSERT INTO public.quotes (
  id, tenant_id, job_id, customer_id, status,
  subtotal_cents, discount_cents, tax_rate_bps, tax_cents, total_cents,
  expires_at, decision_token_hash, sent_at
) VALUES (
  '77000000-0000-4000-8000-000000000021', '22000000-0000-4000-8000-000000000001',
  '55000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001', 'sent',
  45000, 0, 0, 0, 45000, '2026-11-20T14:00:00Z', 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', '2026-10-21T14:00:00Z'
);
UPDATE public.tenant_settings SET quote_follow_up_emails_enabled = true WHERE tenant_id = '22000000-0000-4000-8000-000000000001';
SELECT is(public.queue_quote_follow_ups('2026-10-24T14:30:00Z'), 1,
  'Quote reminder is queued');
SELECT is(
  (SELECT subject FROM public.transactional_emails WHERE kind = 'quote_reminder'),
  'Su cotización de Follow Up', 'Spanish quote reminder subject'
);
SELECT ok(
  (SELECT body LIKE 'Hola Reminder:%le envió una cotización por "Reminder job" ($450.00) el 21 de octubre.%disponible hasta el 20 de noviembre.%'
   FROM public.transactional_emails WHERE kind = 'quote_reminder'),
  'Spanish quote reminder shows the job, amount, and Spanish dates'
);

ROLLBACK;
