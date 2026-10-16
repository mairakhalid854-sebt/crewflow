BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(18);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '16000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'signature-owner-a@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '16000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'signature-owner-b@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '16000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
    'signature-tech-a@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '16000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
    'signature-tech-other@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

INSERT INTO public.tenants (
  id, legal_name, display_name, business_email, time_zone, service_categories
) VALUES
  (
    '26000000-0000-4000-8000-000000000001', 'Signature Tenant A LLC',
    'Signature Tenant A', 'signature-a@crewflow.test', 'America/Chicago', ARRAY['HVAC']
  ),
  (
    '26000000-0000-4000-8000-000000000002', 'Signature Tenant B LLC',
    'Signature Tenant B', 'signature-b@crewflow.test', 'America/New_York', ARRAY['Cleaning']
  );

INSERT INTO public.memberships (id, tenant_id, user_id, role, status, joined_at)
VALUES
  (
    '36000000-0000-4000-8000-000000000001',
    '26000000-0000-4000-8000-000000000001',
    '16000000-0000-4000-8000-000000000001', 'owner', 'active', now()
  ),
  (
    '36000000-0000-4000-8000-000000000002',
    '26000000-0000-4000-8000-000000000002',
    '16000000-0000-4000-8000-000000000002', 'owner', 'active', now()
  ),
  (
    '36000000-0000-4000-8000-000000000003',
    '26000000-0000-4000-8000-000000000001',
    '16000000-0000-4000-8000-000000000003', 'technician', 'active', now()
  ),
  (
    '36000000-0000-4000-8000-000000000004',
    '26000000-0000-4000-8000-000000000001',
    '16000000-0000-4000-8000-000000000004', 'technician', 'active', now()
  );

INSERT INTO public.customers (id, tenant_id, first_name, last_name, postal_code)
VALUES (
  '56000000-0000-4000-8000-000000000001',
  '26000000-0000-4000-8000-000000000001', 'Signature', 'Customer', '78701'
);

INSERT INTO public.jobs (
  id, tenant_id, customer_id, assigned_membership_id, title,
  scheduled_start_at, scheduled_end_at
) VALUES (
  '66000000-0000-4000-8000-000000000001',
  '26000000-0000-4000-8000-000000000001',
  '56000000-0000-4000-8000-000000000001',
  '36000000-0000-4000-8000-000000000003', 'Signature field repair',
  '2026-10-20T15:00:00Z', '2026-10-20T16:00:00Z'
);

UPDATE public.jobs SET status = 'quoted'
WHERE id = '66000000-0000-4000-8000-000000000001';
UPDATE public.jobs SET status = 'accepted'
WHERE id = '66000000-0000-4000-8000-000000000001';
UPDATE public.jobs SET status = 'scheduled'
WHERE id = '66000000-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"16000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);

SELECT throws_ok(
  $$SELECT public.record_assigned_job_signature(
    '66000000-0000-4000-8000-000000000001',
    'Jamie Customer',
    'I confirm that the work described above was completed and authorize this electronic signature to be attached to this CrewFlow job.',
    '[[{"x":0.1,"y":0.2},{"x":0.8,"y":0.7}]]'::jsonb
  )$$,
  '22023',
  'customer signature requires in-progress work',
  'A signature cannot be recorded before work starts'
);
SELECT lives_ok(
  $$SELECT public.advance_assigned_job(
    '66000000-0000-4000-8000-000000000001', 'in_progress', 'Customer present.'
  )$$,
  'Assigned technician can start the job'
);
SELECT throws_ok(
  $$SELECT public.record_assigned_job_signature(
    '66000000-0000-4000-8000-000000000001',
    'Jamie Customer',
    'I confirm that the work described above was completed and authorize this electronic signature to be attached to this CrewFlow job.',
    '[[{"x":-0.1,"y":0.2},{"x":0.8,"y":0.7}]]'::jsonb
  )$$,
  '22023',
  'signature points must use normalized coordinates',
  'Out-of-bounds signature data is rejected'
);
SELECT throws_ok(
  $$SELECT public.record_assigned_job_signature(
    '66000000-0000-4000-8000-000000000001',
    'Jamie Customer', 'I agree',
    '[[{"x":0.1,"y":0.2},{"x":0.8,"y":0.7}]]'::jsonb
  )$$,
  '22023',
  'the required customer consent was not accepted',
  'Altered consent text is rejected'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"16000000-0000-4000-8000-000000000004","role":"authenticated"}',
  true
);
SELECT throws_ok(
  $$SELECT public.record_assigned_job_signature(
    '66000000-0000-4000-8000-000000000001',
    'Jamie Customer',
    'I confirm that the work described above was completed and authorize this electronic signature to be attached to this CrewFlow job.',
    '[[{"x":0.1,"y":0.2},{"x":0.8,"y":0.7}]]'::jsonb
  )$$,
  '42501',
  'assigned job not found or unavailable',
  'Another technician cannot record the signature'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"16000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
SELECT lives_ok(
  $$SELECT set_config(
    'crewflow.signature_result',
    row_to_json(result)::text,
    true
  )
  FROM public.record_assigned_job_signature(
    '66000000-0000-4000-8000-000000000001',
    '  Jamie Customer  ',
    'I confirm that the work described above was completed and authorize this electronic signature to be attached to this CrewFlow job.',
    '[[{"x":0.1,"y":0.2},{"x":0.45,"y":0.75},{"x":0.8,"y":0.3}]]'::jsonb
  ) AS result$$,
  'Assigned technician can record a valid signature'
);
SELECT ok(
  (current_setting('crewflow.signature_result')::jsonb ->> 'signature_id')::uuid IS NOT NULL,
  'The command returns the immutable signature identifier'
);
SELECT is((SELECT count(*) FROM public.job_signatures), 1::bigint, 'Assigned technician can read the recorded signature');
SELECT is((SELECT signer_name FROM public.job_signatures), 'Jamie Customer', 'Signer name is normalized');
SELECT is(
  (SELECT signature_strokes FROM public.job_signatures),
  '[[{"x": 0.1, "y": 0.2}, {"x": 0.45, "y": 0.75}, {"x": 0.8, "y": 0.3}]]'::jsonb,
  'Normalized stroke data is retained'
);
SELECT ok((SELECT signed_at IS NOT NULL FROM public.job_signatures), 'Server timestamp is recorded');
SELECT matches(
  (SELECT integrity_hash FROM public.job_signatures),
  '^[0-9a-f]{64}$',
  'SHA-256 integrity evidence is recorded'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.audit_events
    WHERE action = 'job.customer_signature_recorded'
      AND entity_id = '66000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'Signature recording creates an audit event'
);
SELECT throws_ok(
  $$SELECT public.record_assigned_job_signature(
    '66000000-0000-4000-8000-000000000001',
    'Jamie Customer',
    'I confirm that the work described above was completed and authorize this electronic signature to be attached to this CrewFlow job.',
    '[[{"x":0.1,"y":0.2},{"x":0.8,"y":0.7}]]'::jsonb
  )$$,
  '23505',
  'a customer signature is already recorded for this job',
  'A second signature cannot replace immutable evidence'
);
SELECT throws_ok(
  $$INSERT INTO public.job_signatures (
    tenant_id, job_id, captured_by_membership_id, signer_name, consent_text,
    signature_strokes, signed_at, integrity_hash
  ) VALUES (
    '26000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000001',
    '36000000-0000-4000-8000-000000000003', 'Bypass Customer',
    'Bypassed consent text that is intentionally long enough for the constraint.',
    '[[{"x":0.1,"y":0.2},{"x":0.8,"y":0.7}]]'::jsonb,
    now(), repeat('a', 64)
  )$$,
  '42501',
  'permission denied for table job_signatures',
  'Technician cannot bypass the guarded signature command'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"16000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT is((SELECT count(*) FROM public.job_signatures), 1::bigint, 'Owner can review the signature');

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"16000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
SELECT is((SELECT count(*) FROM public.job_signatures), 0::bigint, 'Another tenant cannot read the signature');

RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT count(*) FROM public.job_signatures$$,
  '42501',
  'permission denied for table job_signatures',
  'Anonymous users cannot read signatures'
);

SELECT * FROM finish();
ROLLBACK;
