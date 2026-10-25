BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(22);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '1b000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'report-owner@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '1b000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'report-tech@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '1b000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
    'other-report-owner@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

INSERT INTO public.tenants (
  id, legal_name, display_name, business_email, time_zone, service_categories
) VALUES
  (
    '2b000000-0000-4000-8000-000000000001', 'Report Tenant LLC',
    'Report Tenant', 'report@crewflow.test', 'America/New_York', ARRAY['Plumbing']
  ),
  (
    '2b000000-0000-4000-8000-000000000002', 'Other Report LLC',
    'Other Report', 'other-report@crewflow.test', 'America/Chicago', ARRAY['HVAC']
  );

INSERT INTO public.tenant_settings (tenant_id)
VALUES
  ('2b000000-0000-4000-8000-000000000001'),
  ('2b000000-0000-4000-8000-000000000002');

INSERT INTO public.memberships (id, tenant_id, user_id, role, status, joined_at)
VALUES
  (
    '3b000000-0000-4000-8000-000000000001',
    '2b000000-0000-4000-8000-000000000001',
    '1b000000-0000-4000-8000-000000000001', 'owner', 'active', now()
  ),
  (
    '3b000000-0000-4000-8000-000000000002',
    '2b000000-0000-4000-8000-000000000001',
    '1b000000-0000-4000-8000-000000000002', 'technician', 'active', now()
  ),
  (
    '3b000000-0000-4000-8000-000000000003',
    '2b000000-0000-4000-8000-000000000002',
    '1b000000-0000-4000-8000-000000000003', 'owner', 'active', now()
  );

INSERT INTO public.staff_availability (
  tenant_id, membership_id, day_of_week, is_available, starts_at, ends_at
) VALUES (
  '2b000000-0000-4000-8000-000000000001',
  '3b000000-0000-4000-8000-000000000002',
  0, true, '08:00', '18:00'
);

INSERT INTO public.services (
  id, tenant_id, name, unit_price_cents, default_duration_minutes
) VALUES (
  '4b000000-0000-4000-8000-000000000001',
  '2b000000-0000-4000-8000-000000000001',
  'Drain Cleaning', 15000, 60
);

INSERT INTO public.customers (
  id, tenant_id, first_name, last_name, email, postal_code
) VALUES (
  '5b000000-0000-4000-8000-000000000001',
  '2b000000-0000-4000-8000-000000000001',
  'Report', 'Customer', 'customer@crewflow.test', '10901'
);

INSERT INTO public.jobs (
  id, tenant_id, customer_id, service_id, assigned_membership_id, title,
  scheduled_start_at, scheduled_end_at
) VALUES
  (
    '6b000000-0000-4000-8000-000000000001',
    '2b000000-0000-4000-8000-000000000001',
    '5b000000-0000-4000-8000-000000000001',
    '4b000000-0000-4000-8000-000000000001',
    '3b000000-0000-4000-8000-000000000002',
    'Kitchen drain repair', '2026-10-25T14:00:00Z', '2026-10-25T15:00:00Z'
  ),
  (
    '6b000000-0000-4000-8000-000000000002',
    '2b000000-0000-4000-8000-000000000001',
    '5b000000-0000-4000-8000-000000000001',
    '4b000000-0000-4000-8000-000000000001',
    '3b000000-0000-4000-8000-000000000002',
    'No notes job', '2026-10-25T16:00:00Z', '2026-10-25T17:00:00Z'
  );

UPDATE public.jobs SET status = 'quoted'
WHERE tenant_id = '2b000000-0000-4000-8000-000000000001';
UPDATE public.jobs SET status = 'accepted'
WHERE tenant_id = '2b000000-0000-4000-8000-000000000001';
UPDATE public.jobs SET status = 'scheduled'
WHERE tenant_id = '2b000000-0000-4000-8000-000000000001';
UPDATE public.jobs SET status = 'in_progress'
WHERE tenant_id = '2b000000-0000-4000-8000-000000000001';
UPDATE public.jobs SET status = 'completed'
WHERE tenant_id = '2b000000-0000-4000-8000-000000000001';

INSERT INTO public.job_work_notes (
  tenant_id, job_id, author_membership_id, body, created_at
) VALUES
  (
    '2b000000-0000-4000-8000-000000000001',
    '6b000000-0000-4000-8000-000000000001',
    '3b000000-0000-4000-8000-000000000002',
    'Cleared the drain blockage.', '2026-10-25T14:45:00Z'
  ),
  (
    '2b000000-0000-4000-8000-000000000001',
    '6b000000-0000-4000-8000-000000000001',
    '3b000000-0000-4000-8000-000000000002',
    'Tested drainage after repair.', '2026-10-25T14:55:00Z'
  );

INSERT INTO public.job_media (
  tenant_id, job_id, uploader_membership_id, media_kind, storage_path,
  content_type, byte_size, uploaded_at
) VALUES
  (
    '2b000000-0000-4000-8000-000000000001',
    '6b000000-0000-4000-8000-000000000001',
    '3b000000-0000-4000-8000-000000000002', 'before',
    'report-test/before.jpg', 'image/jpeg', 1024, now()
  ),
  (
    '2b000000-0000-4000-8000-000000000001',
    '6b000000-0000-4000-8000-000000000001',
    '3b000000-0000-4000-8000-000000000002', 'after',
    'report-test/after.jpg', 'image/jpeg', 1024, now()
  );

INSERT INTO public.job_signatures (
  tenant_id, job_id, captured_by_membership_id, signer_name, consent_text,
  signature_strokes, signed_at, integrity_hash
) VALUES (
  '2b000000-0000-4000-8000-000000000001',
  '6b000000-0000-4000-8000-000000000001',
  '3b000000-0000-4000-8000-000000000002', 'Report Customer',
  'I confirm that the recorded work is complete.',
  '[{"x":1,"y":1},{"x":2,"y":2}]'::jsonb, now(), repeat('b', 64)
);

INSERT INTO public.work_reports (
  tenant_id, job_id, customer_id, summary, work_performed, parts_used,
  recommendations, created_by_user_id
) VALUES (
  '2b000000-0000-4000-8000-000000000001',
  '6b000000-0000-4000-8000-000000000001',
  '5b000000-0000-4000-8000-000000000001',
  'Old summary', 'Old work', 'Old parts', 'Old recommendations',
  '1b000000-0000-4000-8000-000000000001'
);

UPDATE public.tenant_settings
SET ai_operations_enabled = true, ai_monthly_budget_cents = 1000
WHERE tenant_id = '2b000000-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"1b000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
SELECT throws_ok(
  $$SELECT public.request_report_proposal(
    '6b000000-0000-4000-8000-000000000001',
    '7b000000-0000-4000-8000-000000000001'
  )$$,
  '42501', 'active office membership required',
  'Technician cannot request a Report proposal'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"1b000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
SELECT throws_ok(
  $$SELECT public.request_report_proposal(
    '6b000000-0000-4000-8000-000000000001',
    '7b000000-0000-4000-8000-000000000002'
  )$$,
  '42501', 'active office membership required',
  'Another tenant owner cannot request a Report proposal'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"1b000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT lives_ok(
  $$SELECT set_config(
    'crewflow.report_result', row_to_json(result)::text, true
  ) FROM public.request_report_proposal(
    '6b000000-0000-4000-8000-000000000001',
    '7b000000-0000-4000-8000-000000000003'
  ) AS result$$,
  'Owner can request an authoritative Report proposal'
);
SELECT is(
  current_setting('crewflow.report_result')::jsonb ->> 'proposal_result',
  'proposed', 'Grounded evidence produces a proposal'
);
SELECT is(
  (SELECT count(*) FROM public.work_reports WHERE job_id = '6b000000-0000-4000-8000-000000000001'),
  1::bigint, 'Proposal does not create another report'
);
SELECT is(
  (SELECT summary FROM public.work_reports WHERE job_id = '6b000000-0000-4000-8000-000000000001'),
  'Old summary', 'Proposal does not mutate the existing draft'
);
SELECT is(
  (SELECT count(*) FROM public.ai_approval_requests WHERE action_kind = 'report.save_draft'),
  1::bigint, 'Proposal creates one pending human approval'
);
SELECT is(
  (SELECT proposed_changes -> 'summary' ->> 'from' FROM public.ai_approval_requests WHERE action_kind = 'report.save_draft'),
  'Old summary', 'Approval records the exact prior summary'
);
SELECT is(
  (SELECT proposed_changes -> 'partsUsed' ->> 'to' FROM public.ai_approval_requests WHERE action_kind = 'report.save_draft'),
  'Unknown - no structured parts-used record was supplied.',
  'Approval marks unsupported parts as unknown'
);
SELECT matches(
  (SELECT rationale FROM public.ai_approval_requests WHERE action_kind = 'report.save_draft'),
  'Counted 1 before and 1 after photos without interpreting image contents\.',
  'Approval records media counts without visual claims'
);
SELECT is(
  (SELECT char_length(target_state_version) FROM public.ai_approval_requests WHERE action_kind = 'report.save_draft'),
  64, 'Approval binds execution to a SHA-256 evidence state'
);
SELECT is(
  (
    SELECT agent_kind::text || ':' || status::text
    FROM public.ai_agent_runs
    WHERE id = (current_setting('crewflow.report_result')::jsonb ->> 'run_id')::uuid
  ),
  'report:succeeded', 'Proposal records a completed governed Report run'
);
SELECT is(
  (
    SELECT count(*) FROM public.ai_run_steps
    WHERE run_id = (current_setting('crewflow.report_result')::jsonb ->> 'run_id')::uuid
  ),
  2::bigint, 'Proposal records evidence and approval trace steps'
);

SELECT lives_ok(
  $$SELECT set_config(
    'crewflow.report_retry', row_to_json(result)::text, true
  ) FROM public.request_report_proposal(
    '6b000000-0000-4000-8000-000000000001',
    '7b000000-0000-4000-8000-000000000003'
  ) AS result$$,
  'Retry with the same correlation is idempotent'
);
SELECT is(
  current_setting('crewflow.report_retry')::jsonb ->> 'run_id',
  current_setting('crewflow.report_result')::jsonb ->> 'run_id',
  'Idempotent retry returns the original run'
);
SELECT is(
  (SELECT count(*) FROM public.ai_approval_requests WHERE action_kind = 'report.save_draft'),
  1::bigint, 'Idempotent retry does not duplicate approval'
);

SELECT lives_ok(
  $$SELECT set_config(
    'crewflow.report_escalation', row_to_json(result)::text, true
  ) FROM public.request_report_proposal(
    '6b000000-0000-4000-8000-000000000002',
    '7b000000-0000-4000-8000-000000000004'
  ) AS result$$,
  'Completed job without notes creates a governed escalation'
);
SELECT is(
  current_setting('crewflow.report_escalation')::jsonb ->> 'proposal_result',
  'escalated', 'Missing technician notes escalate'
);
SELECT is(
  (
    SELECT count(*) FROM public.ai_approval_requests
    WHERE target_entity_id = '6b000000-0000-4000-8000-000000000002'
  ),
  0::bigint, 'Escalation does not fabricate an approval'
);
SELECT is(
  (
    SELECT count(*) FROM public.audit_events
    WHERE action IN ('ai.report_proposed', 'ai.report_escalated')
  ),
  2::bigint, 'Proposal and escalation both leave audit evidence'
);
SELECT is(
  (SELECT count(*) FROM public.invoices),
  0::bigint, 'Report proposal does not create an invoice'
);
SELECT is(
  (SELECT count(*) FROM public.ai_approval_requests WHERE status = 'pending'),
  1::bigint, 'Only the grounded draft awaits human approval'
);

ROLLBACK;
