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

UPDATE public.invoices
SET paid_cents = total_cents, status = 'paid'
WHERE id = '66000000-0000-4000-8000-000000000002';

INSERT INTO public.follow_up_messages (
  id, tenant_id, invoice_id, customer_id, kind, category, milestone_day,
  dedupe_key, to_email, subject, body, payment_state_source, settled_at,
  target_state_version, status, ready_at, next_attempt_at
) VALUES
  (
    '77000000-0000-4000-8000-000000000011',
    '22000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000002',
    '44000000-0000-4000-8000-000000000002', 'review_request', 'marketing', NULL,
    'marketing-test-review-due', 'review@example.com', 'How did we do?',
    'Please leave a review.', 'provider_confirmed', now() - interval '3 days',
    repeat('a', 64), 'ready', now(), now() - interval '1 minute'
  ),
  (
    '77000000-0000-4000-8000-000000000012',
    '22000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000002',
    '44000000-0000-4000-8000-000000000002', 'review_request', 'marketing', NULL,
    'marketing-test-review-later', 'review@example.com', 'Quick favor?',
    'Please leave a review.', 'provider_confirmed', now() - interval '3 days',
    repeat('b', 64), 'ready', now(), now() + interval '1 hour'
  );

SELECT is(
  (SELECT count(*) FROM vault.secrets WHERE name = 'crewflow_unsubscribe_signing_key'),
  1::bigint,
  'The migration provisions one Vault signing key'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT is(
  (SELECT count(*) FROM public.claim_follow_up_email_deliveries(10)),
  0::bigint,
  'Marketing mail is never claimed while the switch is off'
);
SELECT is(
  (SELECT status FROM public.follow_up_messages
   WHERE id = '77000000-0000-4000-8000-000000000011')::text,
  'ready',
  'Held marketing mail stays ready'
);
SELECT is(
  (SELECT count(*) FROM public.claim_follow_up_email_deliveries(10, true)),
  0::bigint,
  'Marketing mail is held while the business has no postal address'
);

RESET ROLE;
UPDATE public.tenants
SET street_address = '1 Main St', city = 'Springfield',
    state_code = 'IL', postal_code = '62701'
WHERE id = '22000000-0000-4000-8000-000000000001';

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config(
  'crewflow.marketing_claim',
  (SELECT coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb)::text
   FROM public.claim_follow_up_email_deliveries(10, true) AS claimed),
  true
);
SELECT is(
  jsonb_array_length(current_setting('crewflow.marketing_claim')::jsonb), 1,
  'An enabled worker claims the due marketing message'
);
SELECT is(
  current_setting('crewflow.marketing_claim')::jsonb -> 0 ->> 'category',
  'marketing',
  'The claim identifies the message as marketing'
);
SELECT is(
  current_setting('crewflow.marketing_claim')::jsonb -> 0 ->> 'postal_address',
  '1 Main St, Springfield, IL 62701, US',
  'The claim carries the business postal address'
);
SELECT ok(
  (current_setting('crewflow.marketing_claim')::jsonb -> 0 ->> 'unsubscribe_token')
    ~ '^44000000-0000-4000-8000-000000000002\.[0-9a-f]{64}$',
  'The claim carries a signed unsubscribe token for that customer'
);
SELECT set_config(
  'crewflow.unsubscribe_token',
  current_setting('crewflow.marketing_claim')::jsonb -> 0 ->> 'unsubscribe_token',
  true
);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT throws_ok(
  'SELECT * FROM public.claim_follow_up_email_deliveries(10, true)',
  '42501', 'permission denied for function claim_follow_up_email_deliveries',
  'Anonymous callers cannot claim email'
);
SELECT is(
  (SELECT company_name || ':' || already_unsubscribed
   FROM public.preview_marketing_unsubscribe(current_setting('crewflow.unsubscribe_token'))),
  'Follow Up:false',
  'A valid link previews the business without unsubscribing'
);
SELECT is(
  public.unsubscribe_marketing_email(
    '44000000-0000-4000-8000-000000000002.' || repeat('a', 64)
  ),
  false,
  'A forged signature is rejected'
);
SELECT is(
  public.unsubscribe_marketing_email(current_setting('crewflow.unsubscribe_token')),
  true,
  'A valid link unsubscribes the customer'
);
SELECT is(
  public.unsubscribe_marketing_email(current_setting('crewflow.unsubscribe_token')),
  true,
  'Repeating the unsubscribe is idempotent'
);

RESET ROLE;
SELECT is(
  (SELECT marketing_email_opted_in FROM public.customers
   WHERE id = '44000000-0000-4000-8000-000000000002'),
  false,
  'Marketing consent is withdrawn'
);
SELECT is(
  (SELECT status::text || ':' || last_error_code FROM public.follow_up_messages
   WHERE id = '77000000-0000-4000-8000-000000000012'),
  'cancelled:recipient_unsubscribed',
  'Queued marketing mail for that customer is cancelled'
);
SELECT is(
  (SELECT count(*) FROM public.audit_events
   WHERE action = 'customer.marketing_unsubscribed'),
  1::bigint,
  'Only the first unsubscribe is audited'
);
SELECT is(
  (SELECT transactional_email_allowed FROM public.customers
   WHERE id = '44000000-0000-4000-8000-000000000002'),
  true,
  'Service email permission is untouched'
);

SELECT * FROM finish();
ROLLBACK;
