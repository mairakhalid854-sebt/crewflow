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


-- A second owner, used to prove an inactive enabling owner is skipped.
INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '11000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
  'second-owner@crewflow.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
);
INSERT INTO public.memberships (id, tenant_id, user_id, role, status, joined_at)
VALUES (
  '33000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000004', 'owner', 'active', now()
);

SELECT lives_ok(
  $$SELECT * FROM public.run_follow_up_scheduler('2026-10-25T15:00:00Z')$$,
  'Scheduler creates a reminder and a review approval'
);
SELECT is((SELECT count(*) FROM public.ai_approval_requests WHERE status = 'pending'), 2::bigint,
  'Both Follow-Up approvals start pending');

-- 1. Nothing happens while every policy is off (the default).
SELECT is((SELECT executed_count FROM public.run_ai_autopilot(50)), 0,
  'Autopilot does nothing until an owner enables a policy');
SELECT is((SELECT count(*) FROM public.ai_approval_requests WHERE status = 'pending'), 2::bigint,
  'Approvals stay pending with every policy off');

-- 2. Only owners can change Autopilot.
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
SELECT throws_ok(
  $$SELECT public.set_ai_autopilot_policy('22000000-0000-4000-8000-000000000001', 'follow_up.payment_reminder', true)$$,
  '42501', 'only an active owner can change Autopilot',
  'A technician cannot enable Autopilot'
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT throws_ok(
  $$SELECT public.set_ai_autopilot_policy('22000000-0000-4000-8000-000000000001', 'billing.refund_everyone', true)$$,
  '23514', NULL,
  'Unknown Autopilot policies are rejected'
);
SELECT is(
  public.set_ai_autopilot_policy('22000000-0000-4000-8000-000000000001', 'follow_up.payment_reminder', true),
  true, 'Owner enables automatic payment reminders'
);
SELECT is((SELECT count(*) FROM public.audit_events WHERE action = 'ai.autopilot_enabled'), 1::bigint,
  'Enabling Autopilot is audited');
SELECT throws_ok(
  $$SELECT * FROM public.run_ai_autopilot(50)$$,
  '42501', 'permission denied for function run_ai_autopilot',
  'Browser users cannot run the Autopilot worker'
);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- 3. The enabled policy runs; the other approval is left for a person.
SELECT is((SELECT executed_count FROM public.run_ai_autopilot(50)), 1,
  'Autopilot executes exactly the enabled payment reminder');
SELECT is((SELECT status::text FROM public.ai_approval_requests WHERE id = (SELECT approval_id FROM public.follow_up_messages WHERE invoice_id = '66000000-0000-4000-8000-000000000001')), 'approved',
  'Reminder approval is approved');
SELECT is((SELECT decided_by_user_id FROM public.ai_approval_requests WHERE id = (SELECT approval_id FROM public.follow_up_messages WHERE invoice_id = '66000000-0000-4000-8000-000000000001')), '11000000-0000-4000-8000-000000000001'::uuid,
  'Autopilot approves on behalf of the enabling owner');
SELECT ok((SELECT decision_reason LIKE 'Approved automatically by Autopilot%' FROM public.ai_approval_requests WHERE id = (SELECT approval_id FROM public.follow_up_messages WHERE invoice_id = '66000000-0000-4000-8000-000000000001')),
  'Decision reason says Autopilot approved it');
SELECT is((SELECT status::text FROM public.follow_up_messages WHERE invoice_id = '66000000-0000-4000-8000-000000000001'), 'ready',
  'Guarded executor made the reminder ready');
SELECT is((SELECT outcome FROM public.ai_autopilot_executions WHERE approval_id = (SELECT approval_id FROM public.follow_up_messages WHERE invoice_id = '66000000-0000-4000-8000-000000000001')), 'executed',
  'Execution outcome is recorded');
SELECT is((SELECT status::text FROM public.ai_approval_requests WHERE id = (SELECT approval_id FROM public.follow_up_messages WHERE invoice_id = '66000000-0000-4000-8000-000000000002')), 'pending',
  'Review request without a policy stays pending');
SELECT is((SELECT executed_count FROM public.run_ai_autopilot(50)), 0,
  'Running again is idempotent');
SELECT is((SELECT count(*) FROM public.ai_autopilot_executions), 1::bigint,
  'No duplicate execution records');

-- 4. Turning AI operations off pauses Autopilot.
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-4000-8000-000000000004","role":"authenticated"}',
  true
);
SELECT is(
  public.set_ai_autopilot_policy('22000000-0000-4000-8000-000000000001', 'follow_up.review_request', true),
  true, 'Second owner enables review requests'
);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
UPDATE public.tenant_settings SET ai_operations_enabled = false WHERE tenant_id = '22000000-0000-4000-8000-000000000001';
SELECT is((SELECT executed_count + skipped_count FROM public.run_ai_autopilot(50)), 0,
  'Autopilot pauses while AI operations are off');
UPDATE public.tenant_settings SET ai_operations_enabled = true WHERE tenant_id = '22000000-0000-4000-8000-000000000001';

-- 5. A deactivated enabling owner can no longer act through Autopilot.
UPDATE public.memberships SET status = 'deactivated'
WHERE id = '33000000-0000-4000-8000-000000000004';
SELECT is((SELECT skipped_count FROM public.run_ai_autopilot(50)), 1,
  'Policy enabled by a deactivated owner is skipped');
SELECT is((SELECT status::text FROM public.ai_approval_requests WHERE id = (SELECT approval_id FROM public.follow_up_messages WHERE invoice_id = '66000000-0000-4000-8000-000000000002')), 'pending',
  'Skipped approval stays pending for a person');

-- 6. Reassignments are never eligible; new assignments are.
SELECT is(
  public.ai_autopilot_policy_key('dispatcher.assign_technician',
    '{"assignedMembershipId":{"from":"33000000-0000-4000-8000-000000000003","to":"33000000-0000-4000-8000-000000000001"}}'::jsonb),
  NULL, 'Dispatcher reassignment never maps to an Autopilot policy'
);
SELECT is(
  public.ai_autopilot_policy_key('dispatcher.assign_technician',
    '{"assignedMembershipId":{"from":null,"to":"33000000-0000-4000-8000-000000000003"}}'::jsonb),
  'dispatcher.assign_new', 'First assignment maps to the new-assignment policy'
);

SELECT is((SELECT count(*) FROM cron.job WHERE jobname = 'crewflow-ai-autopilot'), 1::bigint,
  'Exactly one Autopilot cron job is installed');

ROLLBACK;
