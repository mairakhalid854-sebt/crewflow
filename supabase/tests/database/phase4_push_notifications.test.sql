BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(26);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '19000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'push-owner-a@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '19000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'push-tech-a@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '19000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
    'push-owner-b@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

INSERT INTO public.tenants (
  id, legal_name, display_name, business_email, time_zone, service_categories
) VALUES
  (
    '29000000-0000-4000-8000-000000000001', 'Push Tenant A LLC',
    'Push Tenant A', 'push-a@crewflow.test', 'America/Chicago', ARRAY['HVAC']
  ),
  (
    '29000000-0000-4000-8000-000000000002', 'Push Tenant B LLC',
    'Push Tenant B', 'push-b@crewflow.test', 'America/New_York', ARRAY['Cleaning']
  );

INSERT INTO public.tenant_settings (tenant_id)
VALUES
  ('29000000-0000-4000-8000-000000000001'),
  ('29000000-0000-4000-8000-000000000002');

INSERT INTO public.memberships (id, tenant_id, user_id, role, status, joined_at)
VALUES
  (
    '39000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    '19000000-0000-4000-8000-000000000001', 'owner', 'active', now()
  ),
  (
    '39000000-0000-4000-8000-000000000002',
    '29000000-0000-4000-8000-000000000001',
    '19000000-0000-4000-8000-000000000002', 'technician', 'active', now()
  ),
  (
    '39000000-0000-4000-8000-000000000003',
    '29000000-0000-4000-8000-000000000002',
    '19000000-0000-4000-8000-000000000003', 'owner', 'active', now()
  );

INSERT INTO public.staff_availability (
  tenant_id, membership_id, day_of_week, is_available, starts_at, ends_at
) VALUES (
  '29000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000002', 2, true, '00:00', '23:59'
);

INSERT INTO public.customers (id, tenant_id, first_name, last_name, postal_code)
VALUES (
  '59000000-0000-4000-8000-000000000001',
  '29000000-0000-4000-8000-000000000001', 'Push', 'Customer', '78701'
);

INSERT INTO public.jobs (
  id, tenant_id, customer_id, title, scheduled_start_at, scheduled_end_at
) VALUES (
  '69000000-0000-4000-8000-000000000001',
  '29000000-0000-4000-8000-000000000001',
  '59000000-0000-4000-8000-000000000001', 'Push notification repair',
  '2026-10-20T15:00:00Z', '2026-10-20T16:00:00Z'
);

SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT public.register_mobile_push_token(
    '49000000-0000-4000-8000-000000000099',
    'ExponentPushToken[anonymous-1234567890]',
    'android'
  )$$,
  '42501',
  'permission denied for function register_mobile_push_token',
  'Anonymous callers cannot register a push token'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"19000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
SELECT throws_ok(
  $$SELECT count(*) FROM public.mobile_push_tokens$$,
  '42501',
  'permission denied for table mobile_push_tokens',
  'Authenticated users cannot read private device tokens'
);
SELECT lives_ok(
  $$SELECT public.register_mobile_push_token(
    '49000000-0000-4000-8000-000000000002',
    'ExponentPushToken[technician-a-1234567890]',
    'android'
  )$$,
  'A technician can register the current app installation'
);
SELECT is(
  (
    SELECT job_assignments_enabled
    FROM public.get_mobile_notification_preferences()
  ),
  true,
  'New notification preferences default to enabled'
);
SELECT lives_ok(
  $$SELECT public.update_mobile_notification_preferences(
    true, false, true, true
  )$$,
  'A member can save granular notification preferences'
);
SELECT is(
  (
    SELECT schedule_changes_enabled
    FROM public.get_mobile_notification_preferences()
  ),
  false,
  'Schedule change opt-out is retained'
);
SELECT throws_ok(
  $$SELECT public.claim_push_notification_deliveries(10)$$,
  '42501',
  'permission denied for function claim_push_notification_deliveries',
  'Authenticated users cannot claim push deliveries'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"19000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT lives_ok(
  $$SELECT public.register_mobile_push_token(
    '49000000-0000-4000-8000-000000000001',
    'ExponentPushToken[owner-a-1234567890]',
    'ios'
  )$$,
  'The tenant owner can register a separate installation'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"19000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
SELECT lives_ok(
  $$SELECT public.register_mobile_push_token(
    '49000000-0000-4000-8000-000000000003',
    'ExponentPushToken[owner-b-1234567890]',
    'android'
  )$$,
  'Another tenant can register without sharing token visibility'
);

RESET ROLE;
SET LOCAL ROLE service_role;
UPDATE public.jobs
SET assigned_membership_id = '39000000-0000-4000-8000-000000000002'
WHERE id = '69000000-0000-4000-8000-000000000001';

SELECT is(
  (
    SELECT count(*)
    FROM public.push_notification_events
    WHERE notification_kind = 'job_assigned'
      AND target_membership_id = '39000000-0000-4000-8000-000000000002'
  ),
  1::bigint,
  'Assigning a job creates one event for the assigned technician'
);
SELECT is(
  (SELECT count(*) FROM public.claim_push_notification_deliveries(10)),
  1::bigint,
  'The delivery worker claims the assignment alert'
);
SELECT is(
  (
    SELECT token.expo_push_token
    FROM public.push_notification_deliveries AS delivery
    JOIN public.mobile_push_tokens AS token ON token.id = delivery.token_id
    WHERE delivery.status = 'processing'
  ),
  'ExponentPushToken[technician-a-1234567890]',
  'The assignment is routed only to the target technician device'
);
SELECT is(
  public.complete_push_notification_deliveries(
    ARRAY(
      SELECT id FROM public.push_notification_deliveries
      WHERE status = 'processing'
    )
  ),
  1,
  'A successful Expo ticket completes the claimed delivery'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.push_notification_deliveries AS delivery
    JOIN public.mobile_push_tokens AS token ON token.id = delivery.token_id
    WHERE token.tenant_id = '29000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'No delivery crosses into another tenant'
);

UPDATE public.jobs
SET scheduled_start_at = '2026-10-20T17:00:00Z',
    scheduled_end_at = '2026-10-20T18:00:00Z'
WHERE id = '69000000-0000-4000-8000-000000000001';
SELECT is(
  (SELECT count(*) FROM public.claim_push_notification_deliveries(10)),
  0::bigint,
  'An opted-out schedule change creates no device delivery'
);
SELECT is(
  (
    SELECT status::text
    FROM public.push_notification_events
    WHERE notification_kind = 'job_rescheduled'
  ),
  'sent',
  'An event with no eligible recipient is closed without retry churn'
);

UPDATE public.jobs
SET status = 'cancelled'
WHERE id = '69000000-0000-4000-8000-000000000001';
SELECT is(
  (SELECT count(*) FROM public.claim_push_notification_deliveries(10)),
  1::bigint,
  'Cancellation alerts remain enabled independently'
);
SELECT is(
  public.retry_push_notification_deliveries(
    ARRAY(
      SELECT id FROM public.push_notification_deliveries
      WHERE status = 'processing'
    ),
    'expo_network_error'
  ),
  1,
  'A transient Expo failure schedules a bounded retry'
);
SELECT is(
  (
    SELECT status::text
    FROM public.push_notification_deliveries
    WHERE last_error_code = 'expo_network_error'
  ),
  'pending',
  'A retryable delivery returns to pending state'
);

INSERT INTO public.work_reports (
  id, tenant_id, job_id, customer_id, summary, work_performed,
  created_by_user_id
) VALUES (
  '79000000-0000-4000-8000-000000000001',
  '29000000-0000-4000-8000-000000000001',
  '69000000-0000-4000-8000-000000000001',
  '59000000-0000-4000-8000-000000000001',
  'Repair complete', 'Replaced the failed component.',
  '19000000-0000-4000-8000-000000000002'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.push_notification_events
    WHERE notification_kind = 'approval_requested'
      AND target_membership_id = '39000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'A draft customer document alerts the tenant approval role'
);

UPDATE public.push_notification_deliveries
SET available_at = now() - interval '1 minute'
WHERE status = 'pending';
SELECT is(
  (SELECT count(*) FROM public.claim_push_notification_deliveries(10)),
  2::bigint,
  'The worker reclaims a due retry and the new approval delivery'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.push_notification_deliveries AS delivery
    JOIN public.mobile_push_tokens AS token ON token.id = delivery.token_id
    WHERE delivery.status = 'processing'
      AND token.expo_push_token = 'ExponentPushToken[owner-a-1234567890]'
  ),
  1::bigint,
  'The approval alert reaches the owner in the same tenant'
);
SELECT is(
  public.disable_invalid_mobile_push_tokens(
    ARRAY['ExponentPushToken[owner-a-1234567890]']
  ),
  1,
  'An invalid Expo token is disabled server-side'
);
SELECT ok(
  (
    SELECT disabled_at IS NOT NULL
    FROM public.mobile_push_tokens
    WHERE expo_push_token = 'ExponentPushToken[owner-a-1234567890]'
  ),
  'The invalid token cannot receive future deliveries'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"19000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
SELECT lives_ok(
  $$SELECT public.disable_mobile_push_token(
    '49000000-0000-4000-8000-000000000002'
  )$$,
  'A member can disable their own app installation'
);
SELECT throws_ok(
  $$SELECT count(*) FROM public.push_notification_events$$,
  '42501',
  'permission denied for table push_notification_events',
  'Authenticated users cannot inspect the private notification outbox'
);

SELECT * FROM finish();
ROLLBACK;
