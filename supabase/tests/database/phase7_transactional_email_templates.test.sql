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

UPDATE public.invoices
SET public_token_hash = pg_catalog.encode(
  extensions.digest(pg_catalog.convert_to(repeat('b', 64), 'UTF8'), 'sha256'),
  'hex'
)
WHERE id = '66000000-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

SELECT set_config(
  'crewflow.invite',
  (SELECT to_jsonb(invitation)::text
   FROM public.create_team_invitation('new-tech@example.com', 'technician') AS invitation),
  true
);
SELECT lives_ok(
  $$SELECT set_config(
    'crewflow.invite_email',
    public.enqueue_transactional_email(
      'team_invitation',
      (current_setting('crewflow.invite')::jsonb ->> 'invitation_id')::uuid,
      current_setting('crewflow.invite')::jsonb ->> 'invitation_token'
    )::text,
    true
  )$$,
  'An owner can request an invitation email with the issued token'
);
SELECT is(
  public.enqueue_transactional_email(
    'team_invitation',
    (current_setting('crewflow.invite')::jsonb ->> 'invitation_id')::uuid,
    current_setting('crewflow.invite')::jsonb ->> 'invitation_token'
  )::text,
  current_setting('crewflow.invite_email'),
  'Requesting the same link twice is idempotent'
);
SELECT throws_ok(
  format(
    'SELECT public.enqueue_transactional_email(%L, %L::uuid, %L)',
    'team_invitation',
    current_setting('crewflow.invite')::jsonb ->> 'invitation_id',
    repeat('c', 64)
  ),
  '42501', 'email target is unavailable',
  'A token that does not match the stored hash is rejected'
);
SELECT throws_ok(
  $$SELECT public.enqueue_transactional_email(
    'invoice', '66000000-0000-4000-8000-000000000001', 'abc'
  )$$,
  '22023', 'email link is invalid',
  'Malformed tokens are rejected'
);
SELECT lives_ok(
  format(
    'SELECT public.enqueue_transactional_email(%L, %L::uuid, %L)',
    'invoice', '66000000-0000-4000-8000-000000000001', repeat('b', 64)
  ),
  'Office roles can request an invoice email'
);
SELECT throws_ok(
  'SELECT * FROM public.transactional_emails',
  '42501', 'permission denied for table transactional_emails',
  'Browser users cannot read queued email or link tokens'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
SELECT throws_ok(
  format(
    'SELECT public.enqueue_transactional_email(%L, %L::uuid, %L)',
    'invoice', '66000000-0000-4000-8000-000000000001', repeat('b', 64)
  ),
  '42501', 'email target is unavailable',
  'Technicians cannot request customer email'
);

RESET ROLE;
SELECT is(
  (SELECT to_email || ' ' || link_path FROM public.transactional_emails
   WHERE kind = 'team_invitation'),
  'new-tech@example.com /signup?next=%2Finvite%2F'
    || (current_setting('crewflow.invite')::jsonb ->> 'invitation_token'),
  'The invitation recipient and link path come from the database'
);
SELECT ok(
  (SELECT position('{{link}}' IN body) > 0
     AND position((current_setting('crewflow.invite')::jsonb ->> 'invitation_token') IN body) = 0
   FROM public.transactional_emails WHERE kind = 'team_invitation'),
  'Stored bodies hold a placeholder, never the raw token'
);
SELECT ok(
  (SELECT subject = 'Follow Up invited you to CrewFlow'
     AND position('join their CrewFlow workspace' IN body) > 0
     AND body LIKE E'%\n\nSent by CrewFlow on behalf of Follow Up.'
   FROM public.transactional_emails WHERE kind = 'team_invitation'),
  'The invitation names the product in the subject, body, and footer'
);
SELECT is(
  (SELECT subject || ' -> ' || to_email FROM public.transactional_emails
   WHERE kind = 'invoice'),
  'Invoice #1 from Follow Up -> reminder@example.com',
  'The invoice email is rendered for the customer on file'
);
SELECT ok(
  (SELECT body ~ 'Amount due: \$[0-9,]+\.[0-9]{2}, due ' FROM public.transactional_emails
   WHERE kind = 'invoice'),
  'The invoice body states the formatted balance and due date'
);
SELECT is(
  (SELECT count(*) FROM public.audit_events WHERE action = 'email.requested'),
  2::bigint,
  'Each new email request is audited once'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config(
  'crewflow.tx_claim',
  (SELECT coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb)::text
   FROM public.claim_transactional_emails(10) AS claimed),
  true
);
SELECT is(
  jsonb_array_length(current_setting('crewflow.tx_claim')::jsonb), 2,
  'Both current emails are claimed'
);
SELECT lives_ok(
  format(
    'SELECT public.complete_transactional_email(%L::uuid, %L::uuid, %L)',
    current_setting('crewflow.invite_email'),
    (SELECT element ->> 'lease_token'
     FROM jsonb_array_elements(current_setting('crewflow.tx_claim')::jsonb) AS element
     WHERE element ->> 'to_email' = 'new-tech@example.com'),
    're_invite_1'
  ),
  'The lease holder completes the invitation email'
);
SELECT is(
  (SELECT status || ':' || coalesce(link_path, 'scrubbed')
   FROM public.transactional_emails WHERE kind = 'team_invitation'),
  'delivered:scrubbed',
  'Delivery scrubs the stored link'
);
SELECT is(
  public.retry_transactional_email(
    (SELECT (element ->> 'email_id')::uuid
     FROM jsonb_array_elements(current_setting('crewflow.tx_claim')::jsonb) AS element
     WHERE element ->> 'to_email' = 'reminder@example.com'),
    (SELECT (element ->> 'lease_token')::uuid
     FROM jsonb_array_elements(current_setting('crewflow.tx_claim')::jsonb) AS element
     WHERE element ->> 'to_email' = 'reminder@example.com'),
    'resend_http_422', true
  ),
  'failed',
  'A permanent rejection fails the invoice email'
);
SELECT ok(
  (SELECT link_path IS NULL FROM public.transactional_emails WHERE kind = 'invoice'),
  'Failure scrubs the stored link'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT set_config(
  'crewflow.invite_revoked',
  (SELECT to_jsonb(invitation)::text
   FROM public.create_team_invitation('second@example.com', 'office') AS invitation),
  true
);
SELECT set_config(
  'crewflow.invite_bounced',
  (SELECT to_jsonb(invitation)::text
   FROM public.create_team_invitation('bounce@example.com', 'office') AS invitation),
  true
);
SELECT lives_ok(
  $$SELECT public.enqueue_transactional_email(
    'team_invitation',
    (current_setting('crewflow.invite_revoked')::jsonb ->> 'invitation_id')::uuid,
    current_setting('crewflow.invite_revoked')::jsonb ->> 'invitation_token'
  )$$,
  'A second invitation email is queued'
);
SELECT lives_ok(
  $$SELECT public.enqueue_transactional_email(
    'team_invitation',
    (current_setting('crewflow.invite_bounced')::jsonb ->> 'invitation_id')::uuid,
    current_setting('crewflow.invite_bounced')::jsonb ->> 'invitation_token'
  )$$,
  'A third invitation email is queued'
);

RESET ROLE;
UPDATE public.team_invitations SET revoked_at = now()
WHERE email = 'second@example.com';

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT is(
  public.record_provider_email_suppression('bounce@example.com', 'hard_bounce'),
  0,
  'Suppressing a non-customer address touches no customers'
);
SELECT is(
  (SELECT count(*) FROM public.claim_transactional_emails(10)),
  0::bigint,
  'Revoked and suppressed invitations are never claimed'
);
SELECT is(
  (SELECT status || ':' || last_error_code || ':' || coalesce(link_path, 'scrubbed')
   FROM public.transactional_emails WHERE to_email = 'second@example.com'),
  'cancelled:stale_email_state:scrubbed',
  'A revoked invitation is cancelled at claim time'
);
SELECT is(
  (SELECT status || ':' || last_error_code || ':' || coalesce(link_path, 'scrubbed')
   FROM public.transactional_emails WHERE to_email = 'bounce@example.com'),
  'cancelled:recipient_suppressed:scrubbed',
  'Provider suppression cancels queued invitation email'
);

RESET ROLE;
SELECT is(
  (SELECT count(*) FROM cron.job WHERE jobname = 'crewflow-deliver-transactional-email'),
  0::bigint,
  'The migration never schedules live delivery'
);

SELECT * FROM finish();
ROLLBACK;
