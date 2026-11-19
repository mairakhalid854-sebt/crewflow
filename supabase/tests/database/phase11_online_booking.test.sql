BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(44);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('11000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'book-owner@crewflow.test', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('11000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'other-owner@crewflow.test', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('11000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'book-tech@crewflow.test', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('11000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'book-office@crewflow.test', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.tenants (
  id, legal_name, display_name, business_email, time_zone, service_categories, phone
) VALUES
  ('22000000-0000-4000-8000-000000000001', 'Book Co LLC', 'Book Co',
   'office@book.test', 'America/New_York', ARRAY['HVAC'], '+12125550100'),
  ('22000000-0000-4000-8000-000000000002', 'Other LLC', 'Other',
   'other@book.test', 'America/Chicago', ARRAY['HVAC'], NULL);

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

UPDATE public.staff_profiles
SET skills = ARRAY['HVAC repair'], service_area_postal_codes = ARRAY['10001']
WHERE membership_id = '33000000-0000-4000-8000-000000000003';

INSERT INTO public.staff_availability (
  tenant_id, membership_id, day_of_week, is_available, starts_at, ends_at
)
SELECT '22000000-0000-4000-8000-000000000001',
  '33000000-0000-4000-8000-000000000003', day, true, '08:00', '18:00'
FROM generate_series(0, 6) AS day
ON CONFLICT (membership_id, day_of_week) DO UPDATE
SET is_available = true, starts_at = '08:00', ends_at = '18:00';

INSERT INTO public.services (
  id, tenant_id, name, unit_price_cents, default_duration_minutes, required_skills
) VALUES
  ('66000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001',
   'AC tune-up', 12900, 60, ARRAY['HVAC repair']),
  ('66000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000001',
   'Duct cleaning', 39900, 120, '{}'),
  ('66000000-0000-4000-8000-000000000003', '22000000-0000-4000-8000-000000000002',
   'Other service', 10000, 60, '{}');

UPDATE public.services SET online_booking_enabled = true
WHERE id = '66000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

SELECT has_table('public', 'booking_pages', 'booking_pages exists');
SELECT has_table('public', 'booking_requests', 'booking_requests exists');
SELECT is(
  (SELECT online_booking_enabled FROM public.services
   WHERE id = '66000000-0000-4000-8000-000000000002'),
  false,
  'services are not bookable online by default'
);

-- ---------------------------------------------------------------------------
-- Owner settings
-- ---------------------------------------------------------------------------

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT is(public.get_public_booking_page('book-co'), NULL,
  'no page before the owner creates one');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.save_booking_page('22000000-0000-4000-8000-000000000001', 'book-co', true)$$,
  '42501', NULL, 'office staff cannot publish the booking page'
);
SELECT throws_ok(
  $$SELECT public.set_service_online_booking('66000000-0000-4000-8000-000000000002', true)$$,
  '42501', NULL, 'office staff cannot change which services are bookable'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.save_booking_page('22000000-0000-4000-8000-000000000001', 'hijack', true)$$,
  '42501', NULL, 'another business owner cannot publish this page'
);
SELECT lives_ok(
  $$SELECT public.save_booking_page('22000000-0000-4000-8000-000000000002', 'other-co', false)$$,
  'the other owner can save their own page'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.save_booking_page('22000000-0000-4000-8000-000000000001', 'other-co', true)$$,
  '23505', NULL, 'a link taken by another business is refused'
);
SELECT throws_ok(
  $$SELECT public.save_booking_page('22000000-0000-4000-8000-000000000001', 'admin', true)$$,
  '23514', NULL, 'reserved links are refused'
);
SELECT throws_ok(
  $$SELECT public.save_booking_page('22000000-0000-4000-8000-000000000001', 'Bad Link!', true)$$,
  '23514', NULL, 'links with spaces or symbols are refused'
);
SELECT is(
  (public.save_booking_page('22000000-0000-4000-8000-000000000001', ' Book-Co ', false,
    'Book your AC service', NULL)).slug,
  'book-co',
  'the owner saves the page and the link is normalized'
);
RESET ROLE;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT is(public.get_public_booking_page('book-co'), NULL,
  'a saved but disabled page is not public');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT lives_ok(
  $$SELECT public.save_booking_page('22000000-0000-4000-8000-000000000001', 'book-co', true,
    'Book your AC service', 'Pick a time that works for you.')$$,
  'the owner enables the page'
);
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Public page and slots
-- ---------------------------------------------------------------------------

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is(public.get_public_booking_page('BOOK-CO') ->> 'business_name', 'Book Co',
  'the public page shows the business name');
SELECT is(jsonb_array_length(public.get_public_booking_page('book-co') -> 'services'), 1,
  'only services opted in to online booking are listed');
SELECT ok(
  (SELECT count(*) FROM public.get_public_booking_slots(
    'book-co', '66000000-0000-4000-8000-000000000001', '10001')) > 0,
  'open times are offered inside the service area'
);
SELECT is(
  (SELECT count(*) FROM public.get_public_booking_slots(
    'book-co', '66000000-0000-4000-8000-000000000001', '90210'))::integer,
  0,
  'no times are offered outside the service area'
);
SELECT is(
  (SELECT count(*) FROM public.get_public_booking_slots(
    'book-co', '66000000-0000-4000-8000-000000000002', '10001'))::integer,
  0,
  'no times are offered for services that are not bookable online'
);
SELECT ok(
  (SELECT min(starts_at) FROM public.get_public_booking_slots(
    'book-co', '66000000-0000-4000-8000-000000000001', '10001'))
    > now() + interval '2 hours',
  'the first offered time is at least two hours away'
);
SELECT throws_ok(
  $$SELECT * FROM public.booking_requests$$,
  '42501', NULL, 'visitors cannot read booking requests'
);

SELECT set_config('crewflow.slot', (
  SELECT starts_at::text FROM public.get_public_booking_slots(
    'book-co', '66000000-0000-4000-8000-000000000001', '10001')
  ORDER BY starts_at LIMIT 1
), true);

-- ---------------------------------------------------------------------------
-- Submitting
-- ---------------------------------------------------------------------------

SELECT throws_ok(
  $$SELECT public.submit_public_booking('book-co',
    '66000000-0000-4000-8000-000000000001',
    current_setting('crewflow.slot')::timestamptz,
    'Ana', 'Lopez', '', '', '1 Main St', '10001')$$,
  '22023', 'email or phone required', 'an email or phone is required'
);
SELECT throws_ok(
  $$SELECT public.submit_public_booking('book-co',
    '66000000-0000-4000-8000-000000000001',
    current_setting('crewflow.slot')::timestamptz,
    'Ana', 'Lopez', 'ana@example.com', '', '1 Main St', 'ABCDE')$$,
  '22023', 'invalid zip', 'a ZIP code is validated'
);
SELECT throws_ok(
  $$SELECT public.submit_public_booking('book-co',
    '66000000-0000-4000-8000-000000000001',
    current_setting('crewflow.slot')::timestamptz,
    'Ana', 'Lopez', NULL, '555-0100', '1 Main St', '10001')$$,
  '22023', 'invalid phone', 'a US phone number is validated'
);
SELECT is(
  public.submit_public_booking('book-co',
    '66000000-0000-4000-8000-000000000001',
    current_setting('crewflow.slot')::timestamptz,
    'Bot', 'Bot', 'bot@example.com', '', '1 Main St', '10001',
    NULL, 'en', false, 'http://spam.example') ->> 'status',
  'received',
  'the hidden bot field returns a fake success'
);
SELECT is(
  public.submit_public_booking('book-co',
    '66000000-0000-4000-8000-000000000001',
    current_setting('crewflow.slot')::timestamptz,
    'Ana', 'Lopez', 'Ana@Example.com', '(212) 555-0199', '1 Main St', '10001',
    'Upstairs unit is loud', 'es', true) ->> 'status',
  'requested',
  'a visitor books an open time'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.get_public_booking_slots(
      'book-co', '66000000-0000-4000-8000-000000000001', '10001')
    WHERE starts_at = current_setting('crewflow.slot')::timestamptz
  ),
  'the booked time is held and no longer offered'
);
SELECT throws_ok(
  $$SELECT public.submit_public_booking('book-co',
    '66000000-0000-4000-8000-000000000001',
    current_setting('crewflow.slot')::timestamptz,
    'Ben', 'Diaz', 'ben@example.com', '', '2 Main St', '10001')$$,
  '40001', 'time no longer available', 'the same time cannot be booked twice'
);

-- Two more requests from Ana in a day are allowed, the fourth is not.
SELECT lives_ok(
  $$SELECT public.submit_public_booking('book-co',
    '66000000-0000-4000-8000-000000000001',
    (SELECT starts_at FROM public.get_public_booking_slots(
      'book-co', '66000000-0000-4000-8000-000000000001', '10001')
     ORDER BY starts_at LIMIT 1),
    'Ana', 'Lopez', 'ana@example.com', '', '1 Main St', '10001')$$,
  'a second request from the same person is allowed'
);
SELECT lives_ok(
  $$SELECT public.submit_public_booking('book-co',
    '66000000-0000-4000-8000-000000000001',
    (SELECT starts_at FROM public.get_public_booking_slots(
      'book-co', '66000000-0000-4000-8000-000000000001', '10001')
     ORDER BY starts_at LIMIT 1),
    'Ana', 'Lopez', 'ana@example.com', '', '1 Main St', '10001')$$,
  'a third request from the same person is allowed'
);
SELECT throws_ok(
  $$SELECT public.submit_public_booking('book-co',
    '66000000-0000-4000-8000-000000000001',
    (SELECT starts_at FROM public.get_public_booking_slots(
      'book-co', '66000000-0000-4000-8000-000000000001', '10001')
     ORDER BY starts_at LIMIT 1),
    'Ana', 'Lopez', 'ana@example.com', '', '1 Main St', '10001')$$,
  '54000', 'booking rate limited', 'a fourth request in a day is refused'
);
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Records created
-- ---------------------------------------------------------------------------

SELECT is(
  (SELECT count(*) FROM public.customers
   WHERE tenant_id = '22000000-0000-4000-8000-000000000001'
     AND lower(email) = 'ana@example.com')::integer,
  1,
  'repeat bookings reuse the same customer record'
);
SELECT is(
  (SELECT row(preferred_language, phone, marketing_email_opted_in)::text
   FROM public.customers WHERE lower(email) = 'ana@example.com'),
  row('es', '+12125550199', true)::text,
  'the customer keeps language, a normalized phone, and marketing consent'
);
SELECT is(
  (SELECT row(job.status, job.assigned_membership_id, job.scheduled_start_at)::text
   FROM public.booking_requests AS request
   JOIN public.jobs AS job ON job.id = request.job_id
   WHERE request.requested_start_at = current_setting('crewflow.slot')::timestamptz),
  row('new'::public.job_status, NULL::uuid, NULL::timestamptz)::text,
  'the job starts as new and unscheduled'
);
SELECT is(
  (SELECT array_agg(kind::text ORDER BY kind::text) FROM public.transactional_emails
   WHERE entity_id = (
     SELECT id FROM public.booking_requests
     WHERE requested_start_at = current_setting('crewflow.slot')::timestamptz
   )),
  ARRAY['booking_request_customer', 'booking_request_owner'],
  'an owner alert and a customer confirmation are queued'
);
SELECT ok(
  (SELECT subject FROM public.transactional_emails
   WHERE kind = 'booking_request_customer' AND to_email = 'ana@example.com'
   ORDER BY created_at LIMIT 1) LIKE 'Recibimos%',
  'the customer confirmation is in the customer''s language'
);

-- ---------------------------------------------------------------------------
-- Office decisions
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT is((SELECT count(*) FROM public.booking_requests)::integer, 0,
  'another business cannot see these requests');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
SELECT is((SELECT count(*) FROM public.booking_requests)::integer, 3,
  'office staff can see the requests');
SELECT is(
  public.apply_booking_request((
    SELECT id FROM public.booking_requests
    WHERE requested_start_at = current_setting('crewflow.slot')::timestamptz
  )),
  'applied',
  'office staff apply the requested time'
);
SELECT throws_ok(
  $$SELECT public.apply_booking_request((
    SELECT id FROM public.booking_requests
    WHERE requested_start_at = current_setting('crewflow.slot')::timestamptz
  ))$$,
  '22023', 'booking request already decided', 'a request cannot be applied twice'
);
SELECT is(
  public.dismiss_booking_request((
    SELECT id FROM public.booking_requests
    WHERE status = 'pending' ORDER BY requested_start_at DESC LIMIT 1
  )),
  'dismissed',
  'office staff dismiss a request'
);
RESET ROLE;

SELECT is(
  (SELECT row(job.status, job.assigned_membership_id,
      job.scheduled_start_at = current_setting('crewflow.slot')::timestamptz)::text
   FROM public.booking_requests AS request
   JOIN public.jobs AS job ON job.id = request.job_id
   WHERE request.requested_start_at = current_setting('crewflow.slot')::timestamptz),
  row('new'::public.job_status, '33000000-0000-4000-8000-000000000003'::uuid, true)::text,
  'the applied job keeps its status and gets the technician and time'
);

-- ---------------------------------------------------------------------------
-- Page availability
-- ---------------------------------------------------------------------------

UPDATE public.tenant_subscriptions SET status = 'canceled', access_mode = 'read_only'
WHERE tenant_id = '22000000-0000-4000-8000-000000000001';

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT is(public.get_public_booking_page('book-co'), NULL,
  'a read-only workspace does not take bookings');
SELECT throws_ok(
  $$SELECT public.submit_public_booking('book-co',
    '66000000-0000-4000-8000-000000000001', now() + interval '3 days',
    'Cy', 'Ng', 'cy@example.com', '', '3 Main St', '10001')$$,
  'P0002', 'booking page unavailable', 'submissions to an unavailable page are refused'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
