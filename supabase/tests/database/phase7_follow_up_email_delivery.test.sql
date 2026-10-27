BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(23);

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

INSERT INTO public.follow_up_messages (
  id, tenant_id, invoice_id, customer_id, kind, category, milestone_day,
  dedupe_key, to_email, subject, body, payment_state_source, settled_at,
  target_state_version, status, ready_at, next_attempt_at
) VALUES
  (
    '77000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000001', 'overdue_3_day', 'transactional', 3,
    'email-test-reminder-due', 'reminder@example.com', 'Invoice 1 is overdue',
    'Your invoice is past due.', 'manual', NULL, repeat('a', 64), 'ready',
    now(), now() - interval '1 minute'
  ),
  (
    '77000000-0000-4000-8000-000000000002',
    '22000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000002',
    '44000000-0000-4000-8000-000000000002', 'review_request', 'marketing', NULL,
    'email-test-review-held', 'review@example.com', 'How did we do?',
    'Please leave a review.', 'provider_confirmed', now() - interval '3 days',
    repeat('b', 64), 'ready', now(), now() - interval '1 minute'
  ),
  (
    '77000000-0000-4000-8000-000000000003',
    '22000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000003',
    '44000000-0000-4000-8000-000000000003', 'overdue_7_day', 'transactional', 7,
    'email-test-suppressed', 'suppressed@example.com', 'Invoice 3 is overdue',
    'Your invoice is past due.', 'manual', NULL, repeat('c', 64), 'ready',
    now(), now() - interval '1 minute'
  ),
  (
    '77000000-0000-4000-8000-000000000004',
    '22000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000001', 'overdue_7_day', 'transactional', 7,
    'email-test-reminder-retry', 'reminder@example.com', 'Invoice 1 reminder',
    'Your invoice is past due.', 'manual', NULL, repeat('d', 64), 'ready',
    now(), now() + interval '1 hour'
  ),
  (
    '77000000-0000-4000-8000-000000000005',
    '22000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000001', 'overdue_14_day', 'transactional', 14,
    'email-test-reminder-later', 'reminder@example.com', 'Invoice 1 final',
    'Your invoice is past due.', 'manual', NULL, repeat('e', 64), 'ready',
    now(), now() + interval '1 hour'
  );

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT throws_ok(
  'SELECT * FROM public.claim_follow_up_email_deliveries(10)',
  '42501', 'permission denied for function claim_follow_up_email_deliveries',
  'Browser users cannot claim email deliveries'
);
SELECT throws_ok(
  $$SELECT public.record_provider_email_suppression('a@example.com', 'complaint')$$,
  '42501', 'permission denied for function record_provider_email_suppression',
  'Browser users cannot suppress recipients'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT lives_ok(
  $$SELECT set_config(
    'crewflow.email_claim',
    (SELECT coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb)::text
     FROM public.claim_follow_up_email_deliveries(10) AS claimed),
    true
  )$$,
  'Service worker can claim due email deliveries'
);
SELECT is(
  jsonb_array_length(current_setting('crewflow.email_claim')::jsonb), 1,
  'Only the due eligible transactional message is claimed'
);
SELECT is(
  current_setting('crewflow.email_claim')::jsonb -> 0 ->> 'message_id',
  '77000000-0000-4000-8000-000000000001',
  'The due reminder is the claimed message'
);
SELECT is(
  current_setting('crewflow.email_claim')::jsonb -> 0 ->> 'sender_name',
  'Follow Up',
  'The claim carries the tenant display name'
);
SELECT is(
  current_setting('crewflow.email_claim')::jsonb -> 0 ->> 'reply_to_email',
  'office@follow-up.test',
  'The claim carries the business reply-to address'
);
SELECT is(
  (SELECT status::text || ':' || attempt_count FROM public.follow_up_messages
   WHERE id = '77000000-0000-4000-8000-000000000001'),
  'processing:1',
  'A claimed message is leased and records attempt one'
);
SELECT is(
  (SELECT status::text FROM public.follow_up_messages
   WHERE id = '77000000-0000-4000-8000-000000000002'),
  'ready',
  'Marketing review requests are never claimed'
);
SELECT is(
  (SELECT status::text || ':' || last_error_code FROM public.follow_up_messages
   WHERE id = '77000000-0000-4000-8000-000000000003'),
  'cancelled:stale_follow_up_state',
  'A suppressed recipient is cancelled instead of sent'
);
SELECT is(
  (SELECT count(*) FROM public.claim_follow_up_email_deliveries(10)),
  0::bigint,
  'A leased message cannot be claimed twice'
);

SELECT throws_ok(
  format(
    'SELECT public.complete_follow_up_email_delivery(%L::uuid, %L::uuid, %L)',
    '77000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 're_test_1'
  ),
  '42501', 'email delivery lease is invalid',
  'Completion requires the current lease'
);
SELECT lives_ok(
  format(
    'SELECT public.complete_follow_up_email_delivery(%L::uuid, %L::uuid, %L)',
    '77000000-0000-4000-8000-000000000001',
    current_setting('crewflow.email_claim')::jsonb -> 0 ->> 'lease_token',
    're_test_1'
  ),
  'The lease holder can complete delivery'
);
SELECT is(
  (SELECT status::text || ':' || provider_message_id FROM public.follow_up_messages
   WHERE id = '77000000-0000-4000-8000-000000000001'),
  'delivered:re_test_1',
  'Completion records the provider message id'
);

RESET ROLE;
UPDATE public.follow_up_messages SET next_attempt_at = now() - interval '1 minute'
WHERE id = '77000000-0000-4000-8000-000000000004';
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT set_config(
  'crewflow.email_retry_claim',
  (SELECT to_jsonb(claimed)::text FROM public.claim_follow_up_email_deliveries(1) AS claimed),
  true
);
SELECT is(
  public.retry_follow_up_email_delivery(
    '77000000-0000-4000-8000-000000000004',
    (current_setting('crewflow.email_retry_claim')::jsonb ->> 'lease_token')::uuid,
    'resend_http_503', false
  ),
  'ready',
  'A transient provider error returns the message to the queue'
);
SELECT ok(
  (SELECT next_attempt_at > now() AND lease_token IS NULL
   FROM public.follow_up_messages
   WHERE id = '77000000-0000-4000-8000-000000000004'),
  'A retried message backs off and releases its lease'
);

RESET ROLE;
UPDATE public.follow_up_messages SET next_attempt_at = now() - interval '1 minute'
WHERE id = '77000000-0000-4000-8000-000000000004';
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT set_config(
  'crewflow.email_retry_claim',
  (SELECT to_jsonb(claimed)::text FROM public.claim_follow_up_email_deliveries(1) AS claimed),
  true
);
SELECT is(
  public.retry_follow_up_email_delivery(
    '77000000-0000-4000-8000-000000000004',
    (current_setting('crewflow.email_retry_claim')::jsonb ->> 'lease_token')::uuid,
    'resend_http_422', true
  ),
  'failed',
  'A permanent provider rejection fails the message'
);
SELECT throws_ok(
  $$SELECT public.retry_follow_up_email_delivery(
    '77000000-0000-4000-8000-000000000004',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Bad Code!', false
  )$$,
  '22023', 'bounded email delivery error code required',
  'Retry error codes are bounded'
);

SELECT is(
  public.record_provider_email_suppression('Reminder@Example.com', 'hard_bounce'),
  1,
  'A hard bounce suppresses the matching customer'
);
SELECT ok(
  (SELECT email_suppressed_at IS NOT NULL FROM public.customers
   WHERE id = '44000000-0000-4000-8000-000000000001'),
  'The bounced customer is marked suppressed'
);
SELECT is(
  (SELECT status::text || ':' || last_error_code FROM public.follow_up_messages
   WHERE id = '77000000-0000-4000-8000-000000000005'),
  'cancelled:recipient_suppressed',
  'Queued mail to a suppressed recipient is cancelled'
);
SELECT throws_ok(
  $$SELECT public.record_provider_email_suppression('a@example.com', 'soft_bounce')$$,
  '22023', 'email suppression reason is invalid',
  'Only hard bounces and complaints suppress'
);

RESET ROLE;
SELECT is(
  (SELECT count(*) FROM cron.job WHERE jobname = 'crewflow-deliver-follow-up-email'),
  0::bigint,
  'The migration never schedules live delivery'
);

SELECT * FROM finish();
ROLLBACK;
