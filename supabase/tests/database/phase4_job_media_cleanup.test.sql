BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(10);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '18000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'cleanup-owner@crewflow.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
);

INSERT INTO public.tenants (
  id, legal_name, display_name, business_email, time_zone, service_categories
) VALUES (
  '28000000-0000-4000-8000-000000000001', 'Cleanup Tenant LLC',
  'Cleanup Tenant', 'cleanup@crewflow.test', 'America/Chicago', ARRAY['HVAC']
);

INSERT INTO public.memberships (id, tenant_id, user_id, role, status, joined_at)
VALUES (
  '38000000-0000-4000-8000-000000000001',
  '28000000-0000-4000-8000-000000000001',
  '18000000-0000-4000-8000-000000000001', 'owner', 'active', now()
);

INSERT INTO public.customers (id, tenant_id, first_name, last_name, postal_code)
VALUES (
  '58000000-0000-4000-8000-000000000001',
  '28000000-0000-4000-8000-000000000001', 'Cleanup', 'Customer', '78701'
);

INSERT INTO public.jobs (id, tenant_id, customer_id, title)
VALUES (
  '68000000-0000-4000-8000-000000000001',
  '28000000-0000-4000-8000-000000000001',
  '58000000-0000-4000-8000-000000000001', 'Cleanup test job'
);

INSERT INTO public.job_media (
  id, tenant_id, job_id, uploader_membership_id, media_kind,
  storage_path, content_type, byte_size, uploaded_at, created_at
) VALUES
  (
    '78000000-0000-4000-8000-000000000001',
    '28000000-0000-4000-8000-000000000001',
    '68000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001', 'before',
    'expired/reservation.jpg', 'image/jpeg', 1000, NULL,
    now() - interval '8 days'
  ),
  (
    '78000000-0000-4000-8000-000000000002',
    '28000000-0000-4000-8000-000000000001',
    '68000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001', 'before',
    'fresh/reservation.jpg', 'image/jpeg', 1000, NULL,
    now() - interval '1 day'
  ),
  (
    '78000000-0000-4000-8000-000000000003',
    '28000000-0000-4000-8000-000000000001',
    '68000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001', 'after',
    'finalized/photo.jpg', 'image/jpeg', 1000, now() - interval '8 days',
    now() - interval '8 days'
  );

SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.claim_expired_job_media_cleanup(100)$$,
  '42501',
  'permission denied for function claim_expired_job_media_cleanup',
  'Authenticated users cannot run media cleanup claims'
);
SELECT throws_ok(
  $$SELECT public.complete_expired_job_media_cleanup(
    ARRAY['78000000-0000-4000-8000-000000000001'::uuid]
  )$$,
  '42501',
  'permission denied for function complete_expired_job_media_cleanup',
  'Authenticated users cannot complete media cleanup'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$SELECT public.claim_expired_job_media_cleanup(0)$$,
  '22023',
  'cleanup batch size must be between 1 and 500',
  'Cleanup claim rejects an empty batch size'
);
SELECT is(
  (SELECT count(*) FROM public.claim_expired_job_media_cleanup(100)),
  1::bigint,
  'Cleanup claims only the expired unfinalized reservation'
);
SELECT ok(
  (
    SELECT cleanup_claimed_at IS NOT NULL
    FROM public.job_media
    WHERE id = '78000000-0000-4000-8000-000000000001'
  ),
  'Expired reservation receives a cleanup lease'
);
SELECT ok(
  (
    SELECT cleanup_claimed_at IS NULL
    FROM public.job_media
    WHERE id = '78000000-0000-4000-8000-000000000002'
  ),
  'Fresh reservation is not claimed'
);
SELECT ok(
  (
    SELECT cleanup_claimed_at IS NULL
    FROM public.job_media
    WHERE id = '78000000-0000-4000-8000-000000000003'
  ),
  'Finalized media is not claimed'
);
SELECT throws_ok(
  $$UPDATE public.job_media
    SET uploaded_at = now()
    WHERE id = '78000000-0000-4000-8000-000000000001'$$,
  '55000',
  'job photo reservation is being cleaned up',
  'A claimed reservation cannot race into finalization'
);
SELECT is(
  public.complete_expired_job_media_cleanup(
    ARRAY['78000000-0000-4000-8000-000000000001'::uuid]
  ),
  1,
  'Cleanup completion deletes claimed metadata'
);
SELECT is(
  (SELECT count(*) FROM public.job_media),
  2::bigint,
  'Fresh and finalized media remain after cleanup'
);

SELECT * FROM finish();
ROLLBACK;
