BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(31);

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
  id, tenant_id, customer_id, title, status
) VALUES
  (
    '55000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000001', 'Reminder job', 'completed'
  ),
  (
    '55000000-0000-4000-8000-000000000002',
    '22000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000002', 'Review job', 'completed'
  ),
  (
    '55000000-0000-4000-8000-000000000003',
    '22000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000003', 'Suppressed job', 'completed'
  ),
  (
    '55000000-0000-4000-8000-000000000004',
    '22000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000001', 'Void job', 'completed'
  );

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

SELECT lives_ok(
  $$SELECT * FROM public.run_follow_up_scheduler('2026-10-25T15:00:00Z')$$,
  'Daily scheduler evaluates eligible invoices'
);
SELECT is((SELECT count(*) FROM public.follow_up_messages), 2::bigint,
  'Only eligible reminder and review messages are persisted');
SELECT is((SELECT count(*) FROM public.ai_agent_runs WHERE agent_kind = 'follow_up'), 2::bigint,
  'Each message has one governed Follow-Up run');
SELECT is((SELECT count(*) FROM public.ai_approval_requests WHERE action_kind = 'follow_up.queue_message'), 2::bigint,
  'Each message requires an exact approval');
SELECT is((SELECT kind::text FROM public.follow_up_messages WHERE invoice_id = '66000000-0000-4000-8000-000000000001'),
  'overdue_3_day', 'Three-day reminder uses the correct milestone');
SELECT is((SELECT kind::text FROM public.follow_up_messages WHERE invoice_id = '66000000-0000-4000-8000-000000000002'),
  'review_request', 'Paid invoice produces the two-day review request');
SELECT is((SELECT payment_state_source::text FROM public.follow_up_messages WHERE invoice_id = '66000000-0000-4000-8000-000000000002'),
  'provider_confirmed', 'Review message records provider-confirmed payment state');
SELECT is((SELECT status::text FROM public.follow_up_messages WHERE invoice_id = '66000000-0000-4000-8000-000000000001'),
  'awaiting_approval', 'Scheduler never makes a message delivery-ready');
SELECT is((SELECT count(*) FROM public.follow_up_messages WHERE status = 'ready'), 0::bigint,
  'No message is ready before approval');
SELECT is((SELECT count(*) FROM public.follow_up_messages WHERE status = 'delivered'), 0::bigint,
  'Scheduler never claims message delivery');
SELECT lives_ok(
  $$SELECT * FROM public.run_follow_up_scheduler('2026-10-25T15:05:00Z')$$,
  'Repeated scheduler invocation is safe'
);
SELECT is((SELECT count(*) FROM public.follow_up_messages), 2::bigint,
  'Stable dedupe keys prevent repeated proposals');
SELECT is((SELECT count(*) FROM cron.job WHERE jobname = 'crewflow-follow-up-daily'), 1::bigint,
  'Exactly one daily Follow-Up cron job is installed');
SELECT is((SELECT count(*) FROM public.follow_up_messages WHERE customer_id = '44000000-0000-4000-8000-000000000003'), 0::bigint,
  'Suppressed contacts never get a proposal');
SELECT is((SELECT count(*) FROM public.follow_up_messages WHERE invoice_id = '66000000-0000-4000-8000-000000000004'), 0::bigint,
  'Void invoices never get a proposal');

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT throws_ok(
  'SELECT * FROM public.run_follow_up_scheduler(now())',
  '42501', 'service role required',
  'Browser users cannot run the global scheduler'
);
SELECT throws_ok(
  format(
    'SELECT * FROM public.execute_approved_follow_up_message(%L)',
    (SELECT approval_id FROM public.follow_up_messages WHERE invoice_id = '66000000-0000-4000-8000-000000000001')
  ),
  'P0001', 'Follow-Up message queue requires an approved request',
  'Pending Follow-Up approval cannot execute'
);
SELECT is(
  public.decide_ai_approval(
    (SELECT approval_id FROM public.follow_up_messages WHERE invoice_id = '66000000-0000-4000-8000-000000000001'),
    'approved', 'Reviewed the exact reminder message.'
  )::text,
  'approved', 'Owner can approve the exact reminder'
);
SELECT lives_ok(
  format(
    $query$SELECT set_config(
      'crewflow.follow_execution', row_to_json(result)::text, true
    ) FROM public.execute_approved_follow_up_message(%L) AS result$query$,
    (SELECT approval_id FROM public.follow_up_messages WHERE invoice_id = '66000000-0000-4000-8000-000000000001')
  ),
  'Approved reminder passes guarded queue execution'
);
SELECT is(current_setting('crewflow.follow_execution')::jsonb ->> 'execution_result',
  'succeeded', 'Guarded Follow-Up execution reports success');
SELECT is((SELECT status::text FROM public.follow_up_messages WHERE invoice_id = '66000000-0000-4000-8000-000000000001'),
  'ready', 'Approved reminder becomes ready for a future provider worker');
SELECT ok((SELECT delivered_at IS NULL FROM public.follow_up_messages WHERE invoice_id = '66000000-0000-4000-8000-000000000001'),
  'Guarded execution does not claim email delivery');
SELECT is(
  (
    SELECT execution_result FROM public.execute_approved_follow_up_message(
      (SELECT approval_id FROM public.follow_up_messages WHERE invoice_id = '66000000-0000-4000-8000-000000000001')
    )
  ),
  'succeeded', 'Repeated guarded execution is idempotent'
);
SELECT is((SELECT count(*) FROM public.follow_up_messages WHERE invoice_id = '66000000-0000-4000-8000-000000000001'),
  1::bigint, 'Idempotent execution never duplicates the reminder');

SELECT is(
  public.decide_ai_approval(
    (SELECT approval_id FROM public.follow_up_messages WHERE invoice_id = '66000000-0000-4000-8000-000000000002'),
    'approved', 'Reviewed before customer suppression changed.'
  )::text,
  'approved', 'Review request can be approved before a preference change'
);
RESET ROLE;
UPDATE public.customers
SET email_suppressed_at = now(),
    email_suppression_reason = 'Customer opted out after proposal.'
WHERE id = '44000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT lives_ok(
  format(
    $query$SELECT set_config(
      'crewflow.follow_stale', row_to_json(result)::text, true
    ) FROM public.execute_approved_follow_up_message(%L) AS result$query$,
    (SELECT approval_id FROM public.follow_up_messages WHERE invoice_id = '66000000-0000-4000-8000-000000000002')
  ),
  'Changed suppression is safely recorded'
);
SELECT is(current_setting('crewflow.follow_stale')::jsonb ->> 'execution_result',
  'rejected_stale', 'New suppression invalidates the approved review request');
SELECT is((SELECT status::text FROM public.follow_up_messages WHERE invoice_id = '66000000-0000-4000-8000-000000000002'),
  'cancelled', 'Stale review message is cancelled');
SELECT is((SELECT count(*) FROM public.follow_up_messages WHERE invoice_id = '66000000-0000-4000-8000-000000000002' AND status = 'ready'),
  0::bigint, 'Suppressed review request never becomes ready');
SELECT is((SELECT count(*) FROM public.audit_events WHERE action = 'ai.follow_up_execution_rejected'),
  1::bigint, 'Rejected execution leaves immutable audit evidence');

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
SELECT is((SELECT count(*) FROM public.follow_up_messages), 0::bigint,
  'Another tenant cannot read Follow-Up messages');

ROLLBACK;
