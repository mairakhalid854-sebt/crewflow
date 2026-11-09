BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(21);

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


INSERT INTO public.services (
  id, tenant_id, name, unit_price_cents, default_duration_minutes
) VALUES
  ('99000000-0000-4000-8000-000000000011', '22000000-0000-4000-8000-000000000001', 'Water heater install', 30000, 180),
  ('99000000-0000-4000-8000-000000000012', '22000000-0000-4000-8000-000000000001', 'Filter change', 9000, 60);

INSERT INTO public.jobs (id, tenant_id, customer_id, service_id, title) VALUES
  ('88000000-0000-4000-8000-000000000011', '22000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000011', 'Profit job 1'),
  ('88000000-0000-4000-8000-000000000012', '22000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000011', 'Profit job 2'),
  ('88000000-0000-4000-8000-000000000013', '22000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000011', 'Profit job 3'),
  ('88000000-0000-4000-8000-000000000014', '22000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000012', 'Profit job 4');
UPDATE public.jobs SET status = 'quoted' WHERE id IN ('88000000-0000-4000-8000-000000000011', '88000000-0000-4000-8000-000000000012', '88000000-0000-4000-8000-000000000013', '88000000-0000-4000-8000-000000000014');
UPDATE public.jobs SET status = 'accepted' WHERE id IN ('88000000-0000-4000-8000-000000000011', '88000000-0000-4000-8000-000000000012', '88000000-0000-4000-8000-000000000013', '88000000-0000-4000-8000-000000000014');
UPDATE public.jobs SET status = 'scheduled', assigned_membership_id = '33000000-0000-4000-8000-000000000003',
  scheduled_start_at = '2026-10-13T12:00:00Z', scheduled_end_at = '2026-10-13T13:00:00Z' WHERE id = '88000000-0000-4000-8000-000000000011';
UPDATE public.jobs SET status = 'scheduled', assigned_membership_id = '33000000-0000-4000-8000-000000000003',
  scheduled_start_at = '2026-10-13T14:00:00Z', scheduled_end_at = '2026-10-13T15:00:00Z' WHERE id = '88000000-0000-4000-8000-000000000012';
UPDATE public.jobs SET status = 'scheduled', assigned_membership_id = '33000000-0000-4000-8000-000000000003',
  scheduled_start_at = '2026-10-13T16:00:00Z', scheduled_end_at = '2026-10-13T17:00:00Z' WHERE id = '88000000-0000-4000-8000-000000000013';
UPDATE public.jobs SET status = 'scheduled', assigned_membership_id = '33000000-0000-4000-8000-000000000003',
  scheduled_start_at = '2026-10-13T20:00:00Z', scheduled_end_at = '2026-10-13T21:00:00Z' WHERE id = '88000000-0000-4000-8000-000000000014';
UPDATE public.jobs SET status = 'in_progress' WHERE id IN ('88000000-0000-4000-8000-000000000011', '88000000-0000-4000-8000-000000000012', '88000000-0000-4000-8000-000000000013', '88000000-0000-4000-8000-000000000014');
UPDATE public.jobs SET status = 'completed' WHERE id IN ('88000000-0000-4000-8000-000000000011', '88000000-0000-4000-8000-000000000012', '88000000-0000-4000-8000-000000000013', '88000000-0000-4000-8000-000000000014');

-- Recorded technician start/finish times (5 hours for each install).
INSERT INTO public.audit_events (tenant_id, action, entity_type, entity_id, metadata, occurred_at)
VALUES
  ('22000000-0000-4000-8000-000000000001', 'job.status_changed', 'job', '88000000-0000-4000-8000-000000000011', '{"from":"scheduled","to":"in_progress"}'::jsonb,
    now() + interval '1 hours'),
  ('22000000-0000-4000-8000-000000000001', 'job.status_changed', 'job', '88000000-0000-4000-8000-000000000011', '{"from":"in_progress","to":"completed"}'::jsonb,
    now() + interval '1 hours' + interval '300 minutes'),
  ('22000000-0000-4000-8000-000000000001', 'job.status_changed', 'job', '88000000-0000-4000-8000-000000000012', '{"from":"scheduled","to":"in_progress"}'::jsonb,
    now() + interval '2 hours'),
  ('22000000-0000-4000-8000-000000000001', 'job.status_changed', 'job', '88000000-0000-4000-8000-000000000012', '{"from":"in_progress","to":"completed"}'::jsonb,
    now() + interval '2 hours' + interval '300 minutes'),
  ('22000000-0000-4000-8000-000000000001', 'job.status_changed', 'job', '88000000-0000-4000-8000-000000000013', '{"from":"scheduled","to":"in_progress"}'::jsonb,
    now() + interval '3 hours'),
  ('22000000-0000-4000-8000-000000000001', 'job.status_changed', 'job', '88000000-0000-4000-8000-000000000013', '{"from":"in_progress","to":"completed"}'::jsonb,
    now() + interval '3 hours' + interval '300 minutes'),
  ('22000000-0000-4000-8000-000000000001', 'job.status_changed', 'job', '88000000-0000-4000-8000-000000000014', '{"from":"scheduled","to":"in_progress"}'::jsonb,
    now() + interval '4 hours'),
  ('22000000-0000-4000-8000-000000000001', 'job.status_changed', 'job', '88000000-0000-4000-8000-000000000014', '{"from":"in_progress","to":"completed"}'::jsonb,
    now() + interval '4 hours' + interval '30 minutes');

UPDATE public.tenant_settings
SET profit_labor_cost_cents_per_hour = 6000, profit_target_margin_bps = 3000
WHERE tenant_id = '22000000-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

SELECT is((SELECT completed_jobs FROM public.get_service_profit_report('22000000-0000-4000-8000-000000000001') WHERE service_id = '99000000-0000-4000-8000-000000000011'), 3,
  'Counts completed jobs for the service');
SELECT is((SELECT median_minutes FROM public.get_service_profit_report('22000000-0000-4000-8000-000000000001') WHERE service_id = '99000000-0000-4000-8000-000000000011'), 300,
  'Measures actual time from start to completion');
SELECT is((SELECT average_revenue_cents FROM public.get_service_profit_report('22000000-0000-4000-8000-000000000001') WHERE service_id = '99000000-0000-4000-8000-000000000011'), 30000::bigint,
  'Falls back to the list price when there is no invoice or quote');
SELECT is((SELECT revenue_per_hour_cents FROM public.get_service_profit_report('22000000-0000-4000-8000-000000000001') WHERE service_id = '99000000-0000-4000-8000-000000000011'), 6000::bigint,
  'Earned per hour uses the measured time');
SELECT is((SELECT cost_per_job_cents FROM public.get_service_profit_report('22000000-0000-4000-8000-000000000001') WHERE service_id = '99000000-0000-4000-8000-000000000011'), 30000::bigint,
  'Labor cost per job uses the owner''s hourly cost');
SELECT is((SELECT margin_bps FROM public.get_service_profit_report('22000000-0000-4000-8000-000000000001') WHERE service_id = '99000000-0000-4000-8000-000000000011'), 0,
  'Margin is computed from earnings and labor cost');
SELECT is((SELECT suggested_price_cents FROM public.get_service_profit_report('22000000-0000-4000-8000-000000000001') WHERE service_id = '99000000-0000-4000-8000-000000000011'), 43000::bigint,
  'Suggested price reaches the 30% target, rounded up to $5');
SELECT ok('takes_longer' = ANY (SELECT unnest(flags) FROM public.get_service_profit_report('22000000-0000-4000-8000-000000000001') WHERE service_id = '99000000-0000-4000-8000-000000000011'),
  'Flags jobs that take over 25% longer than planned');
SELECT ok('below_target' = ANY (SELECT unnest(flags) FROM public.get_service_profit_report('22000000-0000-4000-8000-000000000001') WHERE service_id = '99000000-0000-4000-8000-000000000011'),
  'Flags margins below the owner target');
SELECT ok(NOT ('below_cost' = ANY (SELECT unnest(flags) FROM public.get_service_profit_report('22000000-0000-4000-8000-000000000001') WHERE service_id = '99000000-0000-4000-8000-000000000011')),
  'Break-even is not reported as a loss');
SELECT ok('not_enough_data' = ANY (SELECT unnest(flags) FROM public.get_service_profit_report('22000000-0000-4000-8000-000000000001') WHERE service_id = '99000000-0000-4000-8000-000000000012'),
  'One timed job is not enough data');
SELECT ok((SELECT suggested_price_cents IS NULL FROM public.get_service_profit_report('22000000-0000-4000-8000-000000000001') WHERE service_id = '99000000-0000-4000-8000-000000000012'),
  'No price suggestion without enough data');

SELECT lives_ok(
  $$SELECT public.set_service_market_price('99000000-0000-4000-8000-000000000011', 35000, 50000, 'Three local competitor websites', '2026-11-01')$$,
  'Owner records a market range with its source'
);
SELECT ok('below_market' = ANY (SELECT unnest(flags) FROM public.get_service_profit_report('22000000-0000-4000-8000-000000000001') WHERE service_id = '99000000-0000-4000-8000-000000000011'),
  'Price below the entered market range is flagged');
SELECT is((SELECT market_price_source FROM public.get_service_profit_report('22000000-0000-4000-8000-000000000001') WHERE service_id = '99000000-0000-4000-8000-000000000011'),
  'Three local competitor websites', 'The market source is shown with the range');
SELECT throws_ok(
  $$SELECT public.set_service_market_price('99000000-0000-4000-8000-000000000011', 50000, 35000, 'Backwards', '2026-11-01')$$,
  '23514', NULL, 'High below low is rejected'
);
SELECT throws_ok(
  $$SELECT public.set_service_market_price('99000000-0000-4000-8000-000000000011', 35000, 50000, NULL, '2026-11-01')$$,
  '23514', NULL, 'A market price without a source is rejected'
);
SELECT lives_ok(
  $$SELECT public.set_service_market_price('99000000-0000-4000-8000-000000000011', NULL, NULL, NULL, NULL)$$,
  'Owner can remove the market price'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
SELECT throws_ok(
  $$SELECT * FROM public.get_service_profit_report('22000000-0000-4000-8000-000000000001')$$,
  '42501', 'only an active owner can view profit data',
  'Technicians cannot see profit data'
);
SELECT throws_ok(
  $$SELECT public.set_service_market_price('99000000-0000-4000-8000-000000000011', 1, 2, 'x x', '2026-11-01')$$,
  '42501', 'only an active owner can set market prices',
  'Technicians cannot set market prices'
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
SELECT throws_ok(
  $$SELECT * FROM public.get_service_profit_report('22000000-0000-4000-8000-000000000001')$$,
  '42501', 'only an active owner can view profit data',
  'Another workspace cannot see profit data'
);
RESET ROLE;

ROLLBACK;
