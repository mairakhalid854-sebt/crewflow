BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(31);

-- ---------------------------------------------------------------------------
-- Fixtures: a business with a live booking page and one bookable service.
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('11000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'ref-owner@crewflow.test', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('11000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'ref-other@crewflow.test', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('11000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'ref-tech@crewflow.test', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('11000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'ref-office@crewflow.test', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.tenants (
  id, legal_name, display_name, business_email, time_zone, service_categories
) VALUES
  ('22000000-0000-4000-8000-000000000001', 'Refer Co LLC', 'Refer Co',
   'office@refer.test', 'America/New_York', ARRAY['HVAC']),
  ('22000000-0000-4000-8000-000000000002', 'Other LLC', 'Other',
   'other@refer.test', 'America/Chicago', ARRAY['HVAC']);

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
  ('33000000-0000-4000-8000-000000000003', '22000000-0000-4000-8000-000000000001',
   '11000000-0000-4000-8000-000000000003', 'technician', 'active', now()),
  ('33000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-000000000001',
   '11000000-0000-4000-8000-000000000004', 'office', 'active', now());

INSERT INTO public.staff_availability (
  tenant_id, membership_id, day_of_week, is_available, starts_at, ends_at
)
SELECT '22000000-0000-4000-8000-000000000001',
  '33000000-0000-4000-8000-000000000003', day, true, '08:00', '18:00'
FROM generate_series(0, 6) AS day
ON CONFLICT (membership_id, day_of_week) DO UPDATE
SET is_available = true, starts_at = '08:00', ends_at = '18:00';

INSERT INTO public.services (
  id, tenant_id, name, unit_price_cents, default_duration_minutes,
  online_booking_enabled
) VALUES (
  '66000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001',
  'AC tune-up', 12900, 60, true
);

INSERT INTO public.booking_pages (tenant_id, slug, enabled)
VALUES ('22000000-0000-4000-8000-000000000001', 'refer-co', true);

INSERT INTO public.customers (
  id, tenant_id, first_name, last_name, email, postal_code
) VALUES
  ('44000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001',
   'Ana', 'Lopez', 'ana@example.com', '10001'),
  ('44000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000002',
   'Other', 'Customer', 'other@example.com', '60601');

SELECT has_table('public', 'referral_programs', 'referral_programs exists');
SELECT has_table('public', 'customer_referral_codes', 'customer_referral_codes exists');
SELECT has_table('public', 'referrals', 'referrals exists');

-- ---------------------------------------------------------------------------
-- Codes and settings
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.get_customer_referral_code('44000000-0000-4000-8000-000000000001')$$,
  '42501', NULL, 'technicians cannot read referral codes'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
SELECT set_config('crewflow.code',
  public.get_customer_referral_code('44000000-0000-4000-8000-000000000001'), true);
SELECT matches(current_setting('crewflow.code'), '^[A-Z0-9]{8}$',
  'office staff get an 8-character referral code');
SELECT is(
  public.get_customer_referral_code('44000000-0000-4000-8000-000000000001'),
  current_setting('crewflow.code'),
  'the same customer keeps the same code'
);
SELECT throws_ok(
  $$SELECT public.get_customer_referral_code('44000000-0000-4000-8000-000000000002')$$,
  '42501', NULL, 'codes for another business are refused'
);
SELECT throws_ok(
  $$SELECT public.save_referral_program('22000000-0000-4000-8000-000000000001', true, 2500, 2500)$$,
  '42501', NULL, 'office staff cannot change the program'
);
RESET ROLE;

-- Program is off: a referred booking creates no referral.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT is(public.get_public_referral_offer('refer-co', current_setting('crewflow.code')),
  NULL, 'no offer is shown while the program is off');
SELECT lives_ok(
  $$SELECT public.submit_public_booking('refer-co',
    '66000000-0000-4000-8000-000000000001',
    (SELECT starts_at FROM public.get_public_booking_slots(
      'refer-co', '66000000-0000-4000-8000-000000000001', '10001')
     ORDER BY starts_at LIMIT 1),
    'Early', 'Friend', 'early@example.com', '', '5 Oak St', '10001',
    NULL, 'en', false, NULL, current_setting('crewflow.code'))$$,
  'a booking with a code still works while the program is off'
);
RESET ROLE;
SELECT is((SELECT count(*) FROM public.referrals)::integer, 0,
  'no referral is recorded while the program is off');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.save_referral_program('22000000-0000-4000-8000-000000000001', true, -1, 2500)$$,
  '23514', NULL, 'negative rewards are refused'
);
SELECT is(
  (public.save_referral_program('22000000-0000-4000-8000-000000000001', true,
    3000, 2000, 'Credit on your next visit')).enabled,
  true,
  'the owner turns the program on'
);
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Referred bookings
-- ---------------------------------------------------------------------------

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT is(
  public.get_public_referral_offer('refer-co', lower(current_setting('crewflow.code')))
    ->> 'referrer_name',
  'Ana L.',
  'the friend sees only the referrer''s first name and last initial'
);
SELECT is(
  (public.get_public_referral_offer('refer-co', current_setting('crewflow.code'))
    ->> 'friend_reward_cents')::integer,
  2000,
  'the friend sees the friend reward'
);
SELECT is(public.get_public_referral_offer('refer-co', 'ZZZZZZZZ'), NULL,
  'unknown codes show no offer');
SELECT is(public.get_public_referral_offer('other-co', current_setting('crewflow.code')),
  NULL, 'codes only work on their own business page');

SELECT lives_ok(
  $$SELECT public.submit_public_booking('refer-co',
    '66000000-0000-4000-8000-000000000001',
    (SELECT starts_at FROM public.get_public_booking_slots(
      'refer-co', '66000000-0000-4000-8000-000000000001', '10001')
     ORDER BY starts_at LIMIT 1),
    'Ben', 'Diaz', 'ben@example.com', '', '6 Oak St', '10001',
    NULL, 'en', false, NULL, current_setting('crewflow.code'))$$,
  'a referred friend books'
);
SELECT lives_ok(
  $$SELECT public.submit_public_booking('refer-co',
    '66000000-0000-4000-8000-000000000001',
    (SELECT starts_at FROM public.get_public_booking_slots(
      'refer-co', '66000000-0000-4000-8000-000000000001', '10001')
     ORDER BY starts_at LIMIT 1),
    'Ben', 'Diaz', 'ben@example.com', '', '6 Oak St', '10001',
    NULL, 'en', false, NULL, current_setting('crewflow.code'))$$,
  'the same friend books again'
);
SELECT lives_ok(
  $$SELECT public.submit_public_booking('refer-co',
    '66000000-0000-4000-8000-000000000001',
    (SELECT starts_at FROM public.get_public_booking_slots(
      'refer-co', '66000000-0000-4000-8000-000000000001', '10001')
     ORDER BY starts_at LIMIT 1),
    'Ana', 'Lopez', 'ana@example.com', '', '1 Main St', '10001',
    NULL, 'en', false, NULL, current_setting('crewflow.code'))$$,
  'the referrer can book with their own code'
);
RESET ROLE;

SELECT is(
  (SELECT row(count(*), min(referrer_reward_cents), min(friend_reward_cents), min(status))::text
   FROM public.referrals),
  row(1::bigint, 3000, 2000, 'pending')::text,
  'one pending referral with a reward snapshot; no repeats and no self-referral'
);

-- ---------------------------------------------------------------------------
-- Qualifying and rewarding
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT is((SELECT count(*) FROM public.referrals)::integer, 0,
  'another business cannot see the referral');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.mark_referral_rewarded((SELECT id FROM public.referrals LIMIT 1))$$,
  '22023', 'only qualified referrals can be rewarded',
  'a pending referral cannot be rewarded yet'
);
SELECT lives_ok(
  $$SELECT public.apply_booking_request((
    SELECT booking_request_id FROM public.referrals LIMIT 1))$$,
  'the office schedules the referred job'
);
RESET ROLE;

UPDATE public.jobs SET status = 'quoted'
WHERE id = (SELECT job_id FROM public.referrals LIMIT 1);
UPDATE public.jobs SET status = 'accepted'
WHERE id = (SELECT job_id FROM public.referrals LIMIT 1);
UPDATE public.jobs SET status = 'scheduled'
WHERE id = (SELECT job_id FROM public.referrals LIMIT 1);
UPDATE public.jobs SET status = 'in_progress'
WHERE id = (SELECT job_id FROM public.referrals LIMIT 1);
SELECT is((SELECT status FROM public.referrals LIMIT 1), 'pending',
  'the referral stays pending until the job is completed');
UPDATE public.jobs SET status = 'completed'
WHERE id = (SELECT job_id FROM public.referrals LIMIT 1);
SELECT is((SELECT status FROM public.referrals LIMIT 1), 'qualified',
  'completing the job qualifies the referral');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
SELECT is(
  public.mark_referral_rewarded((SELECT id FROM public.referrals LIMIT 1)),
  'rewarded',
  'office staff record that the rewards were given'
);
SELECT throws_ok(
  $$SELECT public.void_referral((SELECT id FROM public.referrals LIMIT 1), 'Mistake')$$,
  '22023', 'referral can no longer be voided', 'a rewarded referral cannot be voided'
);
RESET ROLE;

-- A cancelled referred job voids its pending referral.
INSERT INTO public.customers (id, tenant_id, first_name, last_name, email, postal_code)
VALUES ('44000000-0000-4000-8000-000000000003', '22000000-0000-4000-8000-000000000001',
  'Cara', 'Ng', 'cara@example.com', '10001');

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT lives_ok(
  $$SELECT public.submit_public_booking('refer-co',
    '66000000-0000-4000-8000-000000000001',
    (SELECT starts_at FROM public.get_public_booking_slots(
      'refer-co', '66000000-0000-4000-8000-000000000001', '10001')
     ORDER BY starts_at LIMIT 1),
    'Cara', 'Ng', 'cara@example.com', '', '7 Oak St', '10001',
    NULL, 'en', false, NULL, current_setting('crewflow.code'))$$,
  'an existing customer can also be referred once'
);
RESET ROLE;

UPDATE public.jobs SET status = 'cancelled'
WHERE id = (
  SELECT job_id FROM public.referrals
  WHERE referred_customer_id = '44000000-0000-4000-8000-000000000003'
);
SELECT is(
  (SELECT status FROM public.referrals
   WHERE referred_customer_id = '44000000-0000-4000-8000-000000000003'),
  'void',
  'cancelling the referred job voids the referral'
);

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT is(public.get_report_referral_invite('not-a-token'), NULL,
  'invalid report tokens get no invite');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
