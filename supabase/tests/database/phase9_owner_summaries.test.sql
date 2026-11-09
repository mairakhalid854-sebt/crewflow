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


-- Saturday 2026-10-24 07:30 in New York is 11:30 UTC.
SELECT is(public.queue_owner_summaries('2026-10-24T11:30:00Z'), 0,
  'Nothing is queued while summaries are off (the default)');

UPDATE public.tenant_settings SET owner_daily_summary_enabled = true
WHERE tenant_id = '22000000-0000-4000-8000-000000000001';

SELECT is(public.queue_owner_summaries('2026-10-24T10:30:00Z'), 0,
  'Nothing is queued outside 7 AM local time');
SELECT is(public.queue_owner_summaries('2026-10-24T11:30:00Z'), 1,
  'One daily summary is queued for the single active owner at 7 AM');
SELECT is(public.queue_owner_summaries('2026-10-24T11:45:00Z'), 0,
  'The same day is never queued twice');

SELECT is(
  (SELECT to_email FROM public.transactional_emails WHERE kind = 'owner_daily_summary'),
  'follow-owner@crewflow.test', 'Summary goes to the owner'
);
SELECT ok(
  (SELECT link_path IS NULL AND status = 'ready'
   FROM public.transactional_emails WHERE kind = 'owner_daily_summary'),
  'Summary is a link-free ready email'
);
SELECT ok(position('- Payments recorded: $200.00' IN (SELECT body FROM public.transactional_emails WHERE kind = 'owner_daily_summary' ORDER BY created_at DESC LIMIT 1)) > 0,
  'Daily summary counts only yesterday''s recorded payments');
SELECT ok(position('- Unpaid invoices: 2 ($200.00)' IN (SELECT body FROM public.transactional_emails WHERE kind = 'owner_daily_summary' ORDER BY created_at DESC LIMIT 1)) > 0,
  'Daily summary totals the remaining unpaid balance');
SELECT ok(position('- Overdue: 2 ($200.00)' IN (SELECT body FROM public.transactional_emails WHERE kind = 'owner_daily_summary' ORDER BY created_at DESC LIMIT 1)) > 0,
  'Daily summary counts overdue invoices');
SELECT ok(position('Follow up on 2 overdue invoice(s) totaling $200.00.' IN (SELECT body FROM public.transactional_emails WHERE kind = 'owner_daily_summary' ORDER BY created_at DESC LIMIT 1)) > 0,
  'Daily summary suggests a next step from the overdue data');
SELECT ok(position('{{link}}' IN (SELECT body FROM public.transactional_emails WHERE kind = 'owner_daily_summary' ORDER BY created_at DESC LIMIT 1)) = 0,
  'Summary contains no link placeholder');

SELECT ok(
  (SELECT public.transactional_email_is_current(
     kind, entity_id, tenant_id, token_hash, to_email)
   FROM public.transactional_emails WHERE kind = 'owner_daily_summary'),
  'Queued summary is current while the owner keeps it on'
);
UPDATE public.tenant_settings SET owner_daily_summary_enabled = false
WHERE tenant_id = '22000000-0000-4000-8000-000000000001';
SELECT ok(
  NOT (SELECT public.transactional_email_is_current(
     kind, entity_id, tenant_id, token_hash, to_email)
   FROM public.transactional_emails WHERE kind = 'owner_daily_summary'),
  'Turning the summary off cancels an unsent one at claim time'
);

-- Monday 2026-10-26 07:30 in New York.
UPDATE public.tenant_settings
SET owner_daily_summary_enabled = true, owner_weekly_summary_enabled = true
WHERE tenant_id = '22000000-0000-4000-8000-000000000001';
SELECT is(public.queue_owner_summaries('2026-10-24T11:30:00Z') , 0,
  'Weekly summary is not sent on a Saturday');
SELECT is(public.queue_owner_summaries('2026-10-26T11:30:00Z'), 2,
  'Monday queues both the daily and the weekly summary');
SELECT ok(position('- Payments recorded: $225.00' IN (SELECT body FROM public.transactional_emails WHERE kind = 'owner_weekly_summary' ORDER BY created_at DESC LIMIT 1)) > 0,
  'Weekly summary sums the previous seven local days');
SELECT is(
  (SELECT subject FROM public.transactional_emails WHERE kind = 'owner_weekly_summary'),
  'Your week at Follow Up: $225.00 received',
  'Weekly subject leads with money received'
);
SELECT is(public.format_usd_cents(123456789), '$1,234,567.89',
  'Money is formatted with cents and separators');

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT ok(
  (SELECT subject IS NOT NULL FROM public.preview_owner_summary('22000000-0000-4000-8000-000000000001', 'owner_daily_summary')),
  'Owner can preview the summary'
);
SELECT throws_ok(
  $$SELECT public.queue_owner_summaries(now())$$,
  '42501', 'permission denied for function queue_owner_summaries',
  'Browser users cannot run the summary scheduler'
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
SELECT throws_ok(
  $$SELECT * FROM public.preview_owner_summary('22000000-0000-4000-8000-000000000001', 'owner_daily_summary')$$,
  '42501', 'only an active owner can preview summaries',
  'A technician cannot preview the owner summary'
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
SELECT throws_ok(
  $$SELECT * FROM public.preview_owner_summary('22000000-0000-4000-8000-000000000001', 'owner_daily_summary')$$,
  '42501', 'only an active owner can preview summaries',
  'Another workspace owner cannot preview this summary'
);
RESET ROLE;

SELECT is((SELECT count(*) FROM cron.job WHERE jobname = 'crewflow-owner-summaries'), 1::bigint,
  'Exactly one owner summary cron job is installed');

ROLLBACK;
