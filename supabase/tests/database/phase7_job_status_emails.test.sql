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

INSERT INTO public.jobs (id, tenant_id, customer_id, title) VALUES
  (
    '55000000-0000-4000-8000-000000000010',
    '22000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000001', 'Window cleaning'
  ),
  (
    '55000000-0000-4000-8000-000000000011',
    '22000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000001', 'Gutter cleaning'
  );

UPDATE public.jobs SET status = 'quoted'
WHERE id IN ('55000000-0000-4000-8000-000000000010', '55000000-0000-4000-8000-000000000011');
UPDATE public.jobs SET status = 'accepted'
WHERE id IN ('55000000-0000-4000-8000-000000000010', '55000000-0000-4000-8000-000000000011');

SELECT is(
  (SELECT count(*) FROM public.transactional_emails
   WHERE entity_id = '55000000-0000-4000-8000-000000000010'),
  0::bigint,
  'Quoting and accepting a job sends no appointment email'
);

UPDATE public.jobs
SET status = 'scheduled',
    assigned_membership_id = '33000000-0000-4000-8000-000000000003',
    scheduled_start_at = '2027-01-05T14:00:00Z',
    scheduled_end_at = '2027-01-05T15:00:00Z'
WHERE id = '55000000-0000-4000-8000-000000000010';

SELECT is(
  (SELECT subject || ' -> ' || to_email FROM public.transactional_emails
   WHERE kind = 'job_scheduled'
     AND entity_id = '55000000-0000-4000-8000-000000000010'),
  'Your appointment with Follow Up is confirmed -> reminder@example.com',
  'Scheduling a job queues a confirmation for the customer'
);
SELECT ok(
  (SELECT position('"Window cleaning" for Tuesday, January 5 from 9:00 AM to 10:00 AM' IN body) > 0
     AND link_path IS NULL
     AND position('{{link}}' IN body) = 0
   FROM public.transactional_emails
   WHERE kind = 'job_scheduled'
     AND entity_id = '55000000-0000-4000-8000-000000000010'),
  'The confirmation states the time in the business time zone without a link'
);
SELECT ok(
  (SELECT body LIKE E'%\n\nSent by CrewFlow on behalf of Follow Up.'
   FROM public.transactional_emails
   WHERE kind = 'job_scheduled'
     AND entity_id = '55000000-0000-4000-8000-000000000010'),
  'The confirmation footer names the product'
);

UPDATE public.jobs
SET scheduled_start_at = '2027-01-12T15:00:00Z',
    scheduled_end_at = '2027-01-12T16:30:00Z'
WHERE id = '55000000-0000-4000-8000-000000000010';

SELECT ok(
  (SELECT position('now scheduled for Tuesday, January 12 from 10:00 AM to 11:30 AM' IN body) > 0
   FROM public.transactional_emails
   WHERE kind = 'job_rescheduled'
     AND entity_id = '55000000-0000-4000-8000-000000000010'),
  'Rescheduling queues an email with the new time'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config(
  'crewflow.job_claim',
  (SELECT coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb)::text
   FROM public.claim_transactional_emails(10) AS claimed),
  true
);
SELECT is(
  jsonb_array_length(current_setting('crewflow.job_claim')::jsonb), 1,
  'Only the latest appointment email is claimed'
);
SELECT ok(
  (current_setting('crewflow.job_claim')::jsonb -> 0 ->> 'subject')
    LIKE '%has a new time'
  AND (current_setting('crewflow.job_claim')::jsonb -> 0 ->> 'link_path') IS NULL,
  'The claimed email is the link-free reschedule notice'
);
SELECT lives_ok(
  format(
    'SELECT public.complete_transactional_email(%L::uuid, %L::uuid, %L)',
    current_setting('crewflow.job_claim')::jsonb -> 0 ->> 'email_id',
    current_setting('crewflow.job_claim')::jsonb -> 0 ->> 'lease_token',
    're_job_1'
  ),
  'A link-free email completes normally'
);

RESET ROLE;
SELECT is(
  (SELECT status || ':' || last_error_code FROM public.transactional_emails
   WHERE kind = 'job_scheduled'
     AND entity_id = '55000000-0000-4000-8000-000000000010'),
  'cancelled:stale_email_state',
  'The superseded confirmation is cancelled instead of sent'
);

UPDATE public.jobs SET status = 'cancelled'
WHERE id = '55000000-0000-4000-8000-000000000010';

SELECT ok(
  (SELECT subject = 'Your appointment with Follow Up was cancelled'
     AND position('scheduled for Tuesday, January 12 from 10:00 AM to 11:30 AM' IN body) > 0
   FROM public.transactional_emails
   WHERE kind = 'job_cancelled'
     AND entity_id = '55000000-0000-4000-8000-000000000010'),
  'Cancelling a scheduled job tells the customer which appointment was cancelled'
);

UPDATE public.tenant_settings SET customer_appointment_emails_enabled = false
WHERE tenant_id = '22000000-0000-4000-8000-000000000001';
UPDATE public.jobs
SET status = 'scheduled',
    assigned_membership_id = '33000000-0000-4000-8000-000000000003',
    scheduled_start_at = '2027-01-19T14:00:00Z',
    scheduled_end_at = '2027-01-19T15:00:00Z'
WHERE id = '55000000-0000-4000-8000-000000000011';

SELECT is(
  (SELECT count(*) FROM public.transactional_emails
   WHERE entity_id = '55000000-0000-4000-8000-000000000011'),
  0::bigint,
  'Workspaces can turn appointment emails off'
);
SELECT is(
  (SELECT status::text FROM public.jobs
   WHERE id = '55000000-0000-4000-8000-000000000011'),
  'scheduled',
  'The job update still succeeds without an email'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT throws_ok(
  format(
    'SELECT public.enqueue_transactional_email(%L, %L::uuid, %L)',
    'job_scheduled', '55000000-0000-4000-8000-000000000011', repeat('a', 64)
  ),
  '22023', 'email link is invalid',
  'Appointment emails cannot be requested directly'
);

SELECT * FROM finish();
ROLLBACK;
