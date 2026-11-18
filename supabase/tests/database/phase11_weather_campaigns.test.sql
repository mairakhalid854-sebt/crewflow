BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(28);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('11000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'wx-owner@crewflow.test', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('11000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'wx-other@crewflow.test', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('11000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'wx-office@crewflow.test', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('11000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'wx-tech@crewflow.test', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.tenants (
  id, legal_name, display_name, business_email, time_zone, service_categories,
  street_address, city, state_code, postal_code
) VALUES
  ('22000000-0000-4000-8000-000000000001', 'Weather Co LLC', 'Weather Co',
   'office@wx.test', 'America/Chicago', ARRAY['HVAC'],
   '100 Congress Ave', 'Austin', 'TX', '78701'),
  ('22000000-0000-4000-8000-000000000002', 'Other LLC', 'Other',
   'other@wx.test', 'America/Chicago', ARRAY['HVAC'], NULL, NULL, NULL, NULL);

UPDATE public.tenant_subscriptions SET access_mode = 'full'
WHERE tenant_id IN (
  '22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000002'
);

INSERT INTO public.memberships (id, tenant_id, user_id, role, status, joined_at)
VALUES
  ('33000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001',
   '11000000-0000-4000-8000-000000000001', 'owner', 'active', now()),
  ('33000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000002',
   '11000000-0000-4000-8000-000000000002', 'owner', 'active', now()),
  ('33000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-000000000001',
   '11000000-0000-4000-8000-000000000004', 'office', 'active', now()),
  ('33000000-0000-4000-8000-000000000003', '22000000-0000-4000-8000-000000000001',
   '11000000-0000-4000-8000-000000000003', 'technician', 'active', now());

-- Ana: eligible. Ben: no marketing consent. Cara: has an open job.
-- Dee: suppressed. Eli: never had a completed job.
INSERT INTO public.customers (
  id, tenant_id, first_name, last_name, email, marketing_email_opted_in
) VALUES
  ('44000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001',
   'Ana', 'Lopez', 'ana@example.com', true),
  ('44000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000001',
   'Ben', 'Diaz', 'ben@example.com', false),
  ('44000000-0000-4000-8000-000000000003', '22000000-0000-4000-8000-000000000001',
   'Cara', 'Ng', 'cara@example.com', true),
  ('44000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-000000000001',
   'Dee', 'Fox', 'dee@example.com', true),
  ('44000000-0000-4000-8000-000000000005', '22000000-0000-4000-8000-000000000001',
   'Eli', 'Ray', 'eli@example.com', true);

UPDATE public.customers
SET email_suppressed_at = now(), email_suppression_reason = 'Bounced.'
WHERE id = '44000000-0000-4000-8000-000000000004';

INSERT INTO public.jobs (id, tenant_id, customer_id, title)
SELECT ('55000000-0000-4000-8000-00000000000' || n)::uuid,
  '22000000-0000-4000-8000-000000000001',
  ('44000000-0000-4000-8000-00000000000' || n)::uuid, 'Past AC repair'
FROM generate_series(1, 4) AS n;
INSERT INTO public.jobs (id, tenant_id, customer_id, title) VALUES (
  '55000000-0000-4000-8000-000000000009', '22000000-0000-4000-8000-000000000001',
  '44000000-0000-4000-8000-000000000003', 'Open job'
);
-- Completed history is set directly; the job workflow itself is tested elsewhere.
ALTER TABLE public.jobs DISABLE TRIGGER USER;
UPDATE public.jobs
SET status = 'completed',
    assigned_membership_id = '33000000-0000-4000-8000-000000000003',
    scheduled_start_at = now() - interval '30 days',
    scheduled_end_at = now() - interval '30 days' + interval '1 hour'
WHERE id IN (
  '55000000-0000-4000-8000-000000000001', '55000000-0000-4000-8000-000000000002',
  '55000000-0000-4000-8000-000000000003', '55000000-0000-4000-8000-000000000004'
);
ALTER TABLE public.jobs ENABLE TRIGGER USER;

SELECT has_table('public', 'weather_campaign_settings', 'settings table exists');
SELECT has_table('public', 'weather_campaigns', 'campaigns table exists');
SELECT has_table('public', 'campaign_messages', 'messages table exists');
SELECT is(
  (SELECT array_agg(first_name ORDER BY first_name)
   FROM public.weather_campaign_audience('22000000-0000-4000-8000-000000000001')),
  ARRAY['Ana'],
  'only opted-in, reachable past customers without open work are in the audience'
);

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.save_weather_campaign_settings('22000000-0000-4000-8000-000000000001', true, 95, 25, false)$$,
  '42501', NULL, 'office staff cannot change campaign settings'
);
SELECT throws_ok(
  $$SELECT public.create_manual_weather_campaign('22000000-0000-4000-8000-000000000001', 'heat')$$,
  '42501', NULL, 'office staff cannot create campaigns'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.save_weather_campaign_settings('22000000-0000-4000-8000-000000000001', true, 150, 25, false)$$,
  '23514', NULL, 'unrealistic heat thresholds are refused'
);
SELECT lives_ok(
  $$SELECT public.save_weather_campaign_settings('22000000-0000-4000-8000-000000000001', true, 95, 25, false)$$,
  'the owner turns weather campaigns on'
);
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Forecast drafts
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.record_weather_campaign_forecast('22000000-0000-4000-8000-000000000001', 'cold', current_date + 3, 18)$$,
  '42501', NULL, 'only the service can record forecasts'
);
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('crewflow.cold', public.record_weather_campaign_forecast(
  '22000000-0000-4000-8000-000000000001', 'cold', current_date + 3, 18)::text, true);
SELECT is(
  (SELECT row(status, audience_count, forecast_temp_f)::text
   FROM public.weather_campaigns WHERE id = current_setting('crewflow.cold')::uuid),
  row('draft', 1, 18)::text,
  'a freeze in the forecast drafts a campaign for the eligible audience'
);
SELECT ok(
  (SELECT body FROM public.weather_campaigns WHERE id = current_setting('crewflow.cold')::uuid)
    LIKE '%18°F%',
  'the draft mentions the forecast low'
);
SELECT is(
  (SELECT count(*) FROM public.transactional_emails
   WHERE kind = 'weather_campaign_ready'
     AND entity_id = current_setting('crewflow.cold')::uuid)::integer,
  1,
  'the owner gets a "campaign ready" email'
);
SELECT is(
  public.record_weather_campaign_forecast(
    '22000000-0000-4000-8000-000000000001', 'cold', current_date + 4, 15),
  NULL,
  'no second cold draft while one is open'
);
SELECT is(
  public.record_weather_campaign_forecast(
    '22000000-0000-4000-8000-000000000002', 'heat', current_date + 2, 101),
  NULL,
  'businesses that did not turn campaigns on get nothing'
);

-- ---------------------------------------------------------------------------
-- Owner review and sending
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT is((SELECT count(*) FROM public.weather_campaigns)::integer, 0,
  'another business cannot see the campaigns');
SELECT throws_ok(
  $$SELECT public.send_weather_campaign(current_setting('crewflow.cold')::uuid,
    'Hello', 'Hi {{first_name}}, this is a long enough message.')$$,
  '42501', NULL, 'another business cannot send the campaign'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT is(
  public.send_weather_campaign(current_setting('crewflow.cold')::uuid,
    'Cold snap coming: is your heat ready?',
    'Hi {{first_name}}, a freeze is coming. Reply to book a heating check.'),
  1,
  'the owner sends the campaign to the audience'
);
SELECT is(
  (SELECT row(subject, body, booking_path)::text FROM public.campaign_messages
   WHERE campaign_id = current_setting('crewflow.cold')::uuid),
  row('Cold snap coming: is your heat ready?',
    'Hi Ana, a freeze is coming. Reply to book a heating check.', NULL::text)::text,
  'each message is personalized with the edited wording'
);
SELECT throws_ok(
  $$SELECT public.cancel_weather_campaign(current_setting('crewflow.cold')::uuid)$$,
  '22023', 'only drafts can be cancelled', 'a sent campaign cannot be cancelled'
);
SELECT throws_ok(
  $$SELECT public.create_manual_weather_campaign('22000000-0000-4000-8000-000000000001', 'heat')$$,
  '22023', NULL, 'customers just emailed are rested before the next campaign'
);
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Delivery
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT * FROM public.claim_campaign_email_deliveries(10)$$,
  '42501', NULL, 'only the service can claim campaign emails'
);
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
CREATE TEMP TABLE claimed_campaign_message AS
SELECT * FROM public.claim_campaign_email_deliveries(10);
SELECT is((SELECT count(*) FROM claimed_campaign_message)::integer, 1,
  'the sender claims the queued message');
SELECT ok(
  (SELECT unsubscribe_token ~ '^[0-9a-f-]{36}\.[0-9a-f]{64}$'
     AND postal_address LIKE '100 Congress Ave, Austin, TX 78701%'
   FROM claimed_campaign_message),
  'each claim carries a signed unsubscribe link and the business address'
);
SELECT is(
  public.complete_campaign_email_delivery(
    (SELECT message_id FROM claimed_campaign_message),
    (SELECT lease_token FROM claimed_campaign_message),
    'resend-123'),
  true,
  'the sender records delivery'
);
SELECT is(
  (SELECT status FROM public.campaign_messages
   WHERE id = (SELECT message_id FROM claimed_campaign_message)),
  'delivered',
  'the message is delivered'
);

-- A customer who opts out before sending is skipped.
INSERT INTO public.campaign_messages (
  tenant_id, campaign_id, customer_id, to_email, subject, body
) VALUES (
  '22000000-0000-4000-8000-000000000001', current_setting('crewflow.cold')::uuid,
  '44000000-0000-4000-8000-000000000002', 'ben@example.com', 'Test', 'Hi Ben, test.'
);
SELECT is((SELECT count(*) FROM public.claim_campaign_email_deliveries(10))::integer, 0,
  'messages to customers without marketing consent are not sent');
SELECT is(
  (SELECT status FROM public.campaign_messages
   WHERE customer_id = '44000000-0000-4000-8000-000000000002'),
  'cancelled',
  'and are cancelled instead'
);

UPDATE public.tenant_subscriptions SET status = 'canceled', access_mode = 'read_only'
WHERE tenant_id = '22000000-0000-4000-8000-000000000001';
SELECT is(
  public.record_weather_campaign_forecast(
    '22000000-0000-4000-8000-000000000001', 'heat', current_date + 2, 104),
  NULL,
  'read-only workspaces get no campaigns'
);

SELECT * FROM finish();
ROLLBACK;
