BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(12);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '14000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'field-owner-a@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '14000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'field-owner-b@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '14000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
    'field-tech-a@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '14000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
    'field-tech-other@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

INSERT INTO public.tenants (
  id, legal_name, display_name, business_email, time_zone, service_categories
) VALUES
  (
    '24000000-0000-4000-8000-000000000001', 'Field Tenant A LLC',
    'Field Tenant A', 'field-a@crewflow.test', 'America/Chicago', ARRAY['HVAC']
  ),
  (
    '24000000-0000-4000-8000-000000000002', 'Field Tenant B LLC',
    'Field Tenant B', 'field-b@crewflow.test', 'America/New_York', ARRAY['Cleaning']
  );

INSERT INTO public.memberships (id, tenant_id, user_id, role, status, joined_at)
VALUES
  (
    '34000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    '14000000-0000-4000-8000-000000000001', 'owner', 'active', now()
  ),
  (
    '34000000-0000-4000-8000-000000000002',
    '24000000-0000-4000-8000-000000000002',
    '14000000-0000-4000-8000-000000000002', 'owner', 'active', now()
  ),
  (
    '34000000-0000-4000-8000-000000000003',
    '24000000-0000-4000-8000-000000000001',
    '14000000-0000-4000-8000-000000000003', 'technician', 'active', now()
  ),
  (
    '34000000-0000-4000-8000-000000000004',
    '24000000-0000-4000-8000-000000000001',
    '14000000-0000-4000-8000-000000000004', 'technician', 'active', now()
  );

INSERT INTO public.customers (id, tenant_id, first_name, last_name, postal_code)
VALUES (
  '54000000-0000-4000-8000-000000000001',
  '24000000-0000-4000-8000-000000000001', 'Field', 'Customer', '78701'
);

INSERT INTO public.jobs (
  id, tenant_id, customer_id, assigned_membership_id, title,
  scheduled_start_at, scheduled_end_at
) VALUES (
  '64000000-0000-4000-8000-000000000001',
  '24000000-0000-4000-8000-000000000001',
  '54000000-0000-4000-8000-000000000001',
  '34000000-0000-4000-8000-000000000003', 'Assigned field repair',
  '2026-10-20T15:00:00Z', '2026-10-20T16:00:00Z'
);

UPDATE public.jobs SET status = 'quoted'
WHERE id = '64000000-0000-4000-8000-000000000001';
UPDATE public.jobs SET status = 'accepted'
WHERE id = '64000000-0000-4000-8000-000000000001';
UPDATE public.jobs SET status = 'scheduled'
WHERE id = '64000000-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"14000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);

SELECT lives_ok(
  $$SELECT public.advance_assigned_job(
    '64000000-0000-4000-8000-000000000001', 'in_progress', 'Arrived and diagnosed system.'
  )$$,
  'Assigned technician can start scheduled work'
);
SELECT is(
  (SELECT status::text FROM public.jobs WHERE id = '64000000-0000-4000-8000-000000000001'),
  'in_progress',
  'Starting work advances the job status'
);
SELECT is((SELECT count(*) FROM public.job_work_notes), 1::bigint, 'Start note is visible to the assigned technician');
SELECT is(
  (SELECT body FROM public.job_work_notes LIMIT 1),
  'Arrived and diagnosed system.',
  'Field note text is retained as an immutable record'
);
SELECT throws_ok(
  $$INSERT INTO public.job_work_notes (
    tenant_id, job_id, author_membership_id, body
  ) VALUES (
    '24000000-0000-4000-8000-000000000001',
    '64000000-0000-4000-8000-000000000001',
    '34000000-0000-4000-8000-000000000003', 'Bypassed command'
  )$$,
  '42501',
  'permission denied for table job_work_notes',
  'Technician cannot bypass the guarded progress command'
);
SELECT throws_ok(
  $$SELECT public.advance_assigned_job(
    '64000000-0000-4000-8000-000000000001', 'completed', ''
  )$$,
  '22023',
  'a completion note is required',
  'Completion requires a useful work note'
);
SELECT lives_ok(
  $$SELECT public.advance_assigned_job(
    '64000000-0000-4000-8000-000000000001', 'completed', 'Repair completed and tested.'
  )$$,
  'Assigned technician can complete in-progress work with a note'
);
SELECT is(
  (SELECT status::text FROM public.jobs WHERE id = '64000000-0000-4000-8000-000000000001'),
  'completed',
  'Completion advances the job status'
);
SELECT is((SELECT count(*) FROM public.job_work_notes), 2::bigint, 'Both immutable notes remain visible');
SELECT is(
  (
    SELECT count(*)
    FROM public.audit_events
    WHERE action = 'job.work_note_added'
      AND entity_id = '64000000-0000-4000-8000-000000000001'
  ),
  2::bigint,
  'Each work note creates an audit event'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"14000000-0000-4000-8000-000000000004","role":"authenticated"}',
  true
);
SELECT throws_ok(
  $$SELECT public.advance_assigned_job(
    '64000000-0000-4000-8000-000000000001', 'completed', 'Unauthorized update.'
  )$$,
  '42501',
  'assigned job not found or unavailable',
  'Another technician cannot update the assignment'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"14000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
SELECT is(
  (SELECT count(*) FROM public.job_work_notes),
  0::bigint,
  'Another tenant cannot read technician work notes'
);

SELECT * FROM finish();
ROLLBACK;
