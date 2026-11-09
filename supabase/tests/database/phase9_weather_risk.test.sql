BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(25);

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
  id, tenant_id, name, unit_price_cents, default_duration_minutes, weather_sensitive
) VALUES
  ('99000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', 'Lawn mowing', 5000, 120, true),
  ('99000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000001', 'Indoor cleaning', 8000, 60, false);

UPDATE public.customers
SET street_address = '100 Congress Ave', city = 'Austin',
    state_code = 'TX', postal_code = '78701'
WHERE id = '44000000-0000-4000-8000-000000000001';

INSERT INTO public.jobs (id, tenant_id, customer_id, service_id, title) VALUES
  ('88000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000001', 'Lawn mowing at Reminder'),
  ('88000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000002', 'Indoor cleaning at Reminder');
UPDATE public.jobs SET status = 'quoted' WHERE id IN ('88000000-0000-4000-8000-000000000001', '88000000-0000-4000-8000-000000000002');
UPDATE public.jobs SET status = 'accepted' WHERE id IN ('88000000-0000-4000-8000-000000000001', '88000000-0000-4000-8000-000000000002');
UPDATE public.jobs
SET status = 'scheduled',
    assigned_membership_id = '33000000-0000-4000-8000-000000000003',
    scheduled_start_at = CASE id WHEN '88000000-0000-4000-8000-000000000001' THEN '2026-10-27T14:00:00Z'::timestamptz
      ELSE '2026-10-27T17:00:00Z'::timestamptz END,
    scheduled_end_at = CASE id WHEN '88000000-0000-4000-8000-000000000001' THEN '2026-10-27T16:00:00Z'::timestamptz
      ELSE '2026-10-27T18:00:00Z'::timestamptz END
WHERE id IN ('88000000-0000-4000-8000-000000000001', '88000000-0000-4000-8000-000000000002');

-- Monday 2026-10-26 16:30 in New York is 20:30 UTC; tomorrow is Tuesday.
SELECT is((SELECT count(*) FROM public.list_weather_check_jobs('2026-10-26T20:30:00Z')), 0::bigint,
  'No jobs are checked while weather alerts are off (the default)');

UPDATE public.tenant_settings SET weather_alerts_enabled = true WHERE tenant_id = '22000000-0000-4000-8000-000000000001';

SELECT is((SELECT count(*) FROM public.list_weather_check_jobs('2026-10-26T19:30:00Z')), 0::bigint,
  'Jobs are only checked at 4 PM local time');
SELECT is((SELECT count(*) FROM public.list_weather_check_jobs('2026-10-26T20:30:00Z')), 1::bigint,
  'Only tomorrow''s weather-sensitive job is checked');
SELECT is((SELECT job_id FROM public.list_weather_check_jobs('2026-10-26T20:30:00Z')), '88000000-0000-4000-8000-000000000001'::uuid,
  'The outdoor job is the one returned');
SELECT is((SELECT forecast_date FROM public.list_weather_check_jobs('2026-10-26T20:30:00Z')), '2026-10-27'::date,
  'Forecast date is tomorrow in the workspace time zone');
SELECT ok((SELECT geocode_status IS NULL FROM public.list_weather_check_jobs('2026-10-26T20:30:00Z')),
  'A new address has no cached location yet');

SELECT lives_ok(
  format($$SELECT public.record_customer_geocode(%L, %L, %s, 'matched', 30.267215, -97.743125)$$,
    '44000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', $$public.customer_address_hash('100 Congress Ave', 'Austin', 'TX', '78701')$$),
  'Worker caches the geocoded location'
);
SELECT is((SELECT latitude FROM public.list_weather_check_jobs('2026-10-26T20:30:00Z')), 30.26722::numeric,
  'Cached latitude is stored with five decimals');

UPDATE public.customers SET street_address = '200 Congress Ave' WHERE id = '44000000-0000-4000-8000-000000000001';
SELECT ok((SELECT geocode_status IS NULL FROM public.list_weather_check_jobs('2026-10-26T20:30:00Z')),
  'Changing the address invalidates the cached location');
UPDATE public.customers SET street_address = '100 Congress Ave' WHERE id = '44000000-0000-4000-8000-000000000001';

SELECT lives_ok(
  format($$SELECT public.record_job_weather_risk(%L, %L, '2026-10-27', 'high', 'thunderstorms, rain 80%%', '{}'::jsonb)$$,
    '88000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001'),
  'Worker records the job risk'
);
SELECT throws_ok(
  format($$SELECT public.record_job_weather_risk(%L, %L, '2026-10-27', 'sunny', 'x', '{}'::jsonb)$$,
    '88000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001'),
  '23514', NULL, 'Unknown risk levels are rejected'
);

SELECT is(public.queue_weather_risk_alert('22000000-0000-4000-8000-000000000001', '2026-10-27'), 1,
  'One alert is queued for the active owner');
SELECT is(public.queue_weather_risk_alert('22000000-0000-4000-8000-000000000001', '2026-10-27'), 0,
  'The same day is never alerted twice');
SELECT is(
  (SELECT subject FROM public.transactional_emails WHERE kind = 'weather_risk_alert'),
  'Weather alert: 1 outdoor job(s) at risk tomorrow', 'Alert subject counts the risky jobs'
);
SELECT ok(
  position('- [HIGH] 10:00 AM Lawn mowing at Reminder (Austin): thunderstorms, rain 80%' IN
    (SELECT body FROM public.transactional_emails WHERE kind = 'weather_risk_alert')) > 0,
  'Alert lists the job, local time, city, and reason'
);
SELECT ok(
  position('Nothing has been rescheduled automatically.' IN
    (SELECT body FROM public.transactional_emails WHERE kind = 'weather_risk_alert')) > 0,
  'Alert says nothing was changed'
);
SELECT ok(
  (SELECT link_path IS NULL FROM public.transactional_emails WHERE kind = 'weather_risk_alert'),
  'Alert is link-free'
);

SELECT ok(
  (SELECT public.transactional_email_is_current(kind, entity_id, tenant_id, token_hash, to_email)
   FROM public.transactional_emails WHERE kind = 'weather_risk_alert'),
  'Alert is current while alerts are on'
);
UPDATE public.tenant_settings SET weather_alerts_enabled = false WHERE tenant_id = '22000000-0000-4000-8000-000000000001';
SELECT ok(
  NOT (SELECT public.transactional_email_is_current(kind, entity_id, tenant_id, token_hash, to_email)
   FROM public.transactional_emails WHERE kind = 'weather_risk_alert'),
  'Turning alerts off cancels an unsent alert'
);
UPDATE public.tenant_settings SET weather_alerts_enabled = true WHERE tenant_id = '22000000-0000-4000-8000-000000000001';

SELECT lives_ok(
  format($$SELECT public.record_job_weather_risk(%L, %L, '2026-10-28', 'clear', 'Looks fine.', '{}'::jsonb)$$,
    '88000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001'),
  'A clear forecast replaces the earlier risk'
);
SELECT is(public.queue_weather_risk_alert('22000000-0000-4000-8000-000000000001', '2026-10-28'), 0,
  'No email when every job looks fine');

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT is((SELECT count(*) FROM public.job_weather_risks), 1::bigint,
  'Owner can read the weather risk');
SELECT throws_ok(
  format($$SELECT public.record_job_weather_risk(%L, %L, '2026-10-27', 'high', 'x', '{}'::jsonb)$$,
    '88000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001'),
  '42501', 'permission denied for function record_job_weather_risk',
  'Browser users cannot write weather risks'
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
SELECT is((SELECT count(*) FROM public.job_weather_risks), 0::bigint,
  'Technicians do not see weather risk records');
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
SELECT is((SELECT count(*) FROM public.job_weather_risks), 0::bigint,
  'Another workspace cannot read weather risks');
RESET ROLE;

ROLLBACK;
