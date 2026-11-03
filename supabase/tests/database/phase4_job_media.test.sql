BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(16);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '15000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'media-owner-a@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '15000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'media-owner-b@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '15000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
    'media-tech-a@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '15000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
    'media-tech-other@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

INSERT INTO public.tenants (
  id, legal_name, display_name, business_email, time_zone, service_categories
) VALUES
  (
    '25000000-0000-4000-8000-000000000001', 'Media Tenant A LLC',
    'Media Tenant A', 'media-a@crewflow.test', 'America/Chicago', ARRAY['HVAC']
  ),
  (
    '25000000-0000-4000-8000-000000000002', 'Media Tenant B LLC',
    'Media Tenant B', 'media-b@crewflow.test', 'America/New_York', ARRAY['Cleaning']
  );

INSERT INTO public.memberships (id, tenant_id, user_id, role, status, joined_at)
VALUES
  (
    '35000000-0000-4000-8000-000000000001',
    '25000000-0000-4000-8000-000000000001',
    '15000000-0000-4000-8000-000000000001', 'owner', 'active', now()
  ),
  (
    '35000000-0000-4000-8000-000000000002',
    '25000000-0000-4000-8000-000000000002',
    '15000000-0000-4000-8000-000000000002', 'owner', 'active', now()
  ),
  (
    '35000000-0000-4000-8000-000000000003',
    '25000000-0000-4000-8000-000000000001',
    '15000000-0000-4000-8000-000000000003', 'technician', 'active', now()
  ),
  (
    '35000000-0000-4000-8000-000000000004',
    '25000000-0000-4000-8000-000000000001',
    '15000000-0000-4000-8000-000000000004', 'technician', 'active', now()
  );

INSERT INTO public.staff_availability (
  tenant_id, membership_id, day_of_week, is_available, starts_at, ends_at
) VALUES (
  '25000000-0000-4000-8000-000000000001',
  '35000000-0000-4000-8000-000000000003', 2, true, '00:00', '23:59'
);

INSERT INTO public.customers (id, tenant_id, first_name, last_name, postal_code)
VALUES (
  '55000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001', 'Media', 'Customer', '78701'
);

INSERT INTO public.jobs (
  id, tenant_id, customer_id, assigned_membership_id, title,
  scheduled_start_at, scheduled_end_at
) VALUES (
  '65000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001',
  '55000000-0000-4000-8000-000000000001',
  '35000000-0000-4000-8000-000000000003', 'Photo field repair',
  '2026-10-20T15:00:00Z', '2026-10-20T16:00:00Z'
);

UPDATE public.jobs SET status = 'quoted'
WHERE id = '65000000-0000-4000-8000-000000000001';
UPDATE public.jobs SET status = 'accepted'
WHERE id = '65000000-0000-4000-8000-000000000001';
UPDATE public.jobs SET status = 'scheduled'
WHERE id = '65000000-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"15000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);

SELECT lives_ok(
  $$SELECT set_config(
    'crewflow.media_reservation',
    row_to_json(reservation)::text,
    true
  )
  FROM public.reserve_assigned_job_media(
    '65000000-0000-4000-8000-000000000001', 'before', 'image/jpeg', 1000
  ) AS reservation$$,
  'Assigned technician can reserve a before-photo upload'
);
SELECT matches(
  current_setting('crewflow.media_reservation')::jsonb ->> 'storage_path',
  '^25000000-0000-4000-8000-000000000001/65000000-0000-4000-8000-000000000001/[0-9a-f-]+[.]jpg$',
  'Reservation path is tenant and job scoped'
);
SELECT is((SELECT count(*) FROM public.job_media), 1::bigint, 'Technician can read their own pending reservation');
SELECT throws_ok(
  $$INSERT INTO public.job_media (
    tenant_id, job_id, uploader_membership_id, media_kind,
    storage_path, content_type, byte_size
  ) VALUES (
    '25000000-0000-4000-8000-000000000001',
    '65000000-0000-4000-8000-000000000001',
    '35000000-0000-4000-8000-000000000003', 'before',
    'bypass.jpg', 'image/jpeg', 100
  )$$,
  '42501',
  'permission denied for table job_media',
  'Technician cannot bypass the reservation command'
);
SELECT throws_ok(
  $$SELECT public.reserve_assigned_job_media(
    '65000000-0000-4000-8000-000000000001', 'after', 'image/jpeg', 1000
  )$$,
  '22023',
  'after photos require in-progress work',
  'After photos are rejected before work starts'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"15000000-0000-4000-8000-000000000004","role":"authenticated"}',
  true
);
SELECT throws_ok(
  $$SELECT public.reserve_assigned_job_media(
    '65000000-0000-4000-8000-000000000001', 'before', 'image/jpeg', 1000
  )$$,
  '42501',
  'assigned job not found or unavailable',
  'Another technician cannot reserve media for the assignment'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"15000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
SELECT lives_ok(
  format(
    $sql$INSERT INTO storage.objects (bucket_id, name, metadata)
      VALUES ('job-media', %L, '{"mimetype":"image/jpeg","size":1000}'::jsonb)$sql$,
    current_setting('crewflow.media_reservation')::jsonb ->> 'storage_path'
  ),
  'Assigned technician can upload only to the reserved private path'
);
SELECT lives_ok(
  format(
    'SELECT public.finalize_assigned_job_media(%L::uuid)',
    current_setting('crewflow.media_reservation')::jsonb ->> 'media_id'
  ),
  'Assigned technician can finalize the matching stored object'
);
SELECT ok(
  (SELECT uploaded_at IS NOT NULL FROM public.job_media LIMIT 1),
  'Finalization marks the reservation uploaded'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.audit_events
    WHERE action = 'job.photo_uploaded'
      AND entity_id = '65000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'Finalization records an audit event'
);
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id = 'job-media'), 1::bigint, 'Assigned technician can read the finalized private object');
SELECT lives_ok(
  $$SELECT public.advance_assigned_job(
    '65000000-0000-4000-8000-000000000001', 'in_progress', 'Started photo-documented work.'
  )$$,
  'Assigned technician can start the job'
);
SELECT lives_ok(
  $$SELECT public.reserve_assigned_job_media(
    '65000000-0000-4000-8000-000000000001', 'after', 'image/jpeg', 1000
  )$$,
  'After-photo reservation is available while work is in progress'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"15000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT is((SELECT count(*) FROM public.job_media), 1::bigint, 'Owner sees only finalized job photos');

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"15000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
SELECT is((SELECT count(*) FROM public.job_media), 0::bigint, 'Another tenant cannot read job photos');

RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT count(*) FROM public.job_media$$,
  '42501',
  'permission denied for table job_media',
  'Anonymous users cannot read job media metadata'
);

SELECT * FROM finish();
ROLLBACK;
