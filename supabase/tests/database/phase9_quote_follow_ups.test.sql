BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(17);

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


INSERT INTO public.quotes (
  id, tenant_id, job_id, customer_id, status,
  subtotal_cents, discount_cents, tax_rate_bps, tax_cents, total_cents,
  expires_at, decision_token_hash, sent_at
) VALUES
  (
    '77000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', '55000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001', 'sent',
    45000, 0, 0, 0, 45000, '2026-11-20T14:00:00Z', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2026-10-21T14:00:00Z'
  ),
  (
    '77000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000001', '55000000-0000-4000-8000-000000000003', '44000000-0000-4000-8000-000000000003', 'sent',
    30000, 0, 0, 0, 30000, '2026-11-20T14:00:00Z', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '2026-10-21T14:00:00Z'
  ),
  (
    '77000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-000000000001', '55000000-0000-4000-8000-000000000002', '44000000-0000-4000-8000-000000000002', 'sent',
    20000, 0, 0, 0, 20000, '2026-10-23T14:00:00Z', 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', '2026-10-21T14:00:00Z'
  ),
  (
    '77000000-0000-4000-8000-000000000005', '22000000-0000-4000-8000-000000000001', '55000000-0000-4000-8000-000000000002', '44000000-0000-4000-8000-000000000002', 'sent',
    12500, 0, 0, 0, 12500, '2026-11-20T14:00:00Z', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', '2026-10-17T14:00:00Z'
  );

INSERT INTO public.quotes (
  id, tenant_id, job_id, customer_id, status,
  subtotal_cents, discount_cents, tax_rate_bps, tax_cents, total_cents,
  expires_at, decision_token_hash, sent_at, accepted_at
) VALUES (
  '77000000-0000-4000-8000-000000000003', '22000000-0000-4000-8000-000000000001',
  '55000000-0000-4000-8000-000000000004', '44000000-0000-4000-8000-000000000001',
  'accepted', 10000, 0, 0, 0, 10000, '2026-11-20T14:00:00Z', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  '2026-10-21T14:00:00Z', '2026-10-22T14:00:00Z'
);

-- Saturday 2026-10-24 10:30 in New York is 14:30 UTC.
SELECT is(public.queue_quote_follow_ups('2026-10-24T14:30:00Z'), 0,
  'No reminders while quote reminders are off (the default)');

UPDATE public.tenant_settings SET quote_follow_up_emails_enabled = true
WHERE tenant_id = '22000000-0000-4000-8000-000000000001';

SELECT is(public.queue_quote_follow_ups('2026-10-24T13:30:00Z'), 0,
  'Reminders are only queued at 10 AM local time');
SELECT is(public.queue_quote_follow_ups('2026-10-24T14:30:00Z'), 2,
  'Day-3 and day-7 open quotes each get one reminder');
SELECT is(public.queue_quote_follow_ups('2026-10-24T14:50:00Z'), 0,
  'The same milestone is never queued twice');
SELECT is(
  (SELECT count(*) FROM public.transactional_emails
   WHERE kind = 'quote_reminder' AND entity_id = '77000000-0000-4000-8000-000000000002'),
  0::bigint, 'Suppressed customers get no reminder'
);
SELECT is(
  (SELECT count(*) FROM public.transactional_emails
   WHERE kind = 'quote_reminder' AND entity_id IN (
     '77000000-0000-4000-8000-000000000003', '77000000-0000-4000-8000-000000000004')),
  0::bigint, 'Accepted and expired quotes get no reminder'
);
SELECT is(
  (SELECT subject FROM public.transactional_emails WHERE entity_id = '77000000-0000-4000-8000-000000000001'),
  'Your quote from Follow Up', 'Day-3 reminder uses the gentle subject'
);
SELECT is(
  (SELECT subject FROM public.transactional_emails WHERE entity_id = '77000000-0000-4000-8000-000000000005'),
  'Still thinking it over? Your quote from Follow Up', 'Day-7 reminder uses the second subject'
);
SELECT ok(
  position('quote for "Reminder job" ($450.00)' IN
    (SELECT body FROM public.transactional_emails WHERE entity_id = '77000000-0000-4000-8000-000000000001')) > 0,
  'Reminder names the job and the exact quote total'
);
SELECT ok(
  (SELECT body LIKE 'Hi Reminder,%' FROM public.transactional_emails WHERE entity_id = '77000000-0000-4000-8000-000000000001'),
  'Reminder greets the customer by first name'
);
SELECT ok(
  (SELECT link_path IS NULL AND position('{{link}}' IN body) = 0 AND to_email = 'reminder@example.com'
   FROM public.transactional_emails WHERE entity_id = '77000000-0000-4000-8000-000000000001'),
  'Reminder is link-free and goes to the customer'
);

SELECT ok(
  (SELECT public.transactional_email_is_current(kind, entity_id, tenant_id, token_hash, to_email)
   FROM public.transactional_emails WHERE entity_id = '77000000-0000-4000-8000-000000000001'),
  'Reminder is current while the quote waits'
);
UPDATE public.quotes SET status = 'accepted', accepted_at = '2026-10-24T15:00:00Z'
WHERE id = '77000000-0000-4000-8000-000000000001';
SELECT ok(
  NOT (SELECT public.transactional_email_is_current(kind, entity_id, tenant_id, token_hash, to_email)
   FROM public.transactional_emails WHERE entity_id = '77000000-0000-4000-8000-000000000001'),
  'A customer decision cancels the unsent reminder'
);
UPDATE public.tenant_settings SET quote_follow_up_emails_enabled = false
WHERE tenant_id = '22000000-0000-4000-8000-000000000001';
SELECT ok(
  NOT (SELECT public.transactional_email_is_current(kind, entity_id, tenant_id, token_hash, to_email)
   FROM public.transactional_emails WHERE entity_id = '77000000-0000-4000-8000-000000000005'),
  'Turning reminders off cancels unsent ones'
);
UPDATE public.tenant_settings SET quote_follow_up_emails_enabled = true
WHERE tenant_id = '22000000-0000-4000-8000-000000000001';

SELECT is(public.queue_quote_follow_ups('2026-10-26T14:30:00Z'), 0,
  'No reminder on days other than 3 and 7');

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT throws_ok(
  $$SELECT public.queue_quote_follow_ups(now())$$,
  '42501', 'permission denied for function queue_quote_follow_ups',
  'Browser users cannot run the reminder scheduler'
);
RESET ROLE;

SELECT is((SELECT count(*) FROM cron.job WHERE jobname = 'crewflow-quote-follow-ups'), 1::bigint,
  'Exactly one quote follow-up cron job is installed');

ROLLBACK;
