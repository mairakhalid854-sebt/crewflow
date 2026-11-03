BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(23);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '1a000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'processor-owner@crewflow.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
);

INSERT INTO public.tenants (
  id, legal_name, display_name, business_email, time_zone, service_categories
) VALUES (
  '2a000000-0000-4000-8000-000000000001', 'Processor Tenant LLC',
  'Processor Tenant', 'processor@crewflow.test', 'America/Los_Angeles', ARRAY['Cleaning']
);

INSERT INTO public.memberships (id, tenant_id, user_id, role, status, joined_at)
VALUES (
  '3a000000-0000-4000-8000-000000000001',
  '2a000000-0000-4000-8000-000000000001',
  '1a000000-0000-4000-8000-000000000001', 'owner', 'active', now()
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"1a000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

SELECT lives_ok(
  $$SELECT set_config(
    'crewflow.processor_reservation', row_to_json(reservation)::text, true
  ) FROM public.reserve_knowledge_document(
    'Safety policy', 'safety.txt', 'text/plain', 12, NULL
  ) AS reservation$$,
  'Owner can reserve a document for processing'
);
SELECT lives_ok(
  format(
    $sql$INSERT INTO storage.objects (bucket_id, name, metadata)
      VALUES ('knowledge-documents', %L, '{"mimetype":"text/plain","size":12}'::jsonb)$sql$,
    current_setting('crewflow.processor_reservation')::jsonb ->> 'storage_path'
  ),
  'Owner can upload the reserved private object'
);
SELECT lives_ok(
  format(
    'SELECT public.finalize_knowledge_document_upload(%L::uuid, %L)',
    current_setting('crewflow.processor_reservation')::jsonb ->> 'document_id',
    repeat('a', 64)
  ),
  'Finalizing an upload queues malware scanning'
);
SELECT throws_ok(
  $$SELECT count(*) FROM public.knowledge_processing_jobs$$,
  '42501',
  'permission denied for table knowledge_processing_jobs',
  'Browser role cannot observe the private processing queue'
);
SELECT throws_ok(
  $$SELECT * FROM public.claim_knowledge_processing_jobs(1)$$,
  '42501',
  'permission denied for function claim_knowledge_processing_jobs',
  'Browser role cannot claim processing work'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT is(
  (SELECT count(*) FROM public.knowledge_processing_jobs WHERE stage = 'scan'),
  1::bigint,
  'One durable scan job was created'
);
SELECT lives_ok(
  $$SELECT set_config(
    'crewflow.scan_claim', row_to_json(claimed)::text, true
  ) FROM public.claim_knowledge_processing_jobs(1) AS claimed$$,
  'Service worker can claim the scan job'
);
SELECT is(
  (current_setting('crewflow.scan_claim')::jsonb ->> 'attempt_count')::integer,
  1,
  'The first lease records attempt one'
);
SELECT throws_ok(
  format(
    'SELECT public.finish_knowledge_scan_job(%L::uuid, %L::uuid, %L, %L, %L, %L, NULL)',
    current_setting('crewflow.scan_claim')::jsonb ->> 'job_id',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'clean', repeat('a', 64), 'test-scanner', '1.0'
  ),
  '22023',
  'knowledge scan lease is invalid',
  'A forged lease cannot finish scanning'
);
SELECT lives_ok(
  format(
    'SELECT public.finish_knowledge_scan_job(%L::uuid, %L::uuid, %L, %L, %L, %L, NULL)',
    current_setting('crewflow.scan_claim')::jsonb ->> 'job_id',
    current_setting('crewflow.scan_claim')::jsonb ->> 'lease_token',
    'clean', repeat('a', 64), 'test-scanner', '1.0'
  ),
  'A clean scan atomically completes its queue job'
);
SELECT is(
  (
    SELECT status::text FROM public.knowledge_documents
    WHERE id = (current_setting('crewflow.processor_reservation')::jsonb ->> 'document_id')::uuid
  ),
  'parse_pending',
  'Clean scan advances the document to parse pending'
);
SELECT is(
  (
    SELECT status::text FROM public.knowledge_processing_jobs
    WHERE id = (current_setting('crewflow.scan_claim')::jsonb ->> 'job_id')::uuid
  ),
  'completed',
  'Scan queue completion is committed with the document transition'
);
SELECT is(
  (SELECT count(*) FROM public.knowledge_processing_jobs WHERE stage = 'parse'),
  1::bigint,
  'The clean transition queues exactly one parser job'
);
SELECT lives_ok(
  $$SELECT set_config(
    'crewflow.parse_claim', row_to_json(claimed)::text, true
  ) FROM public.claim_knowledge_processing_jobs(1) AS claimed$$,
  'Service worker can claim the parse job'
);
SELECT lives_ok(
  format(
    $sql$SELECT public.finish_knowledge_parse_job(
      %L::uuid, %L::uuid,
      '[{"content":"Safety policy text.","page_number":null,"character_start":0,"character_end":19,"citation_label":"safety.txt - chunk 1"}]'::jsonb,
      NULL
    )$sql$,
    current_setting('crewflow.parse_claim')::jsonb ->> 'job_id',
    current_setting('crewflow.parse_claim')::jsonb ->> 'lease_token'
  ),
  'A valid parse atomically completes its queue job'
);
SELECT is(
  (
    SELECT status::text FROM public.knowledge_documents
    WHERE id = (current_setting('crewflow.processor_reservation')::jsonb ->> 'document_id')::uuid
  ),
  'ready',
  'Only the scanned and parsed document becomes ready'
);
SELECT is(
  (SELECT count(*) FROM public.knowledge_document_chunks),
  1::bigint,
  'Parser completion writes the bounded citation chunk'
);
SELECT is(
  (SELECT count(*) FROM public.knowledge_processing_jobs WHERE status = 'completed'),
  2::bigint,
  'Both durable stages are completed'
);

SELECT lives_ok(
  $$
    INSERT INTO public.knowledge_documents (
      id, tenant_id, logical_document_id, version, title, original_file_name,
      media_type, byte_size, storage_path, upload_sha256_claim, created_by_user_id
    ) VALUES (
      '4a000000-0000-4000-8000-000000000001',
      '2a000000-0000-4000-8000-000000000001',
      '4a000000-0000-4000-8000-000000000001', 1, 'Retry document',
      'retry.txt', 'text/plain', 5, 'retry/retry.txt', repeat('b', 64),
      '1a000000-0000-4000-8000-000000000001'
    );
    UPDATE public.knowledge_documents
    SET status = 'scan_pending', uploaded_at = now()
    WHERE id = '4a000000-0000-4000-8000-000000000001';
  $$,
  'A second pending document receives its scan job'
);
SELECT lives_ok(
  $$
  DO $body$
  DECLARE claim record; result public.knowledge_processing_job_status;
  BEGIN
    FOR attempt IN 1..5 LOOP
      UPDATE public.knowledge_processing_jobs
      SET available_at = now()
      WHERE document_id = '4a000000-0000-4000-8000-000000000001'
        AND status = 'queued';
      SELECT * INTO claim FROM public.claim_knowledge_processing_jobs(1);
      SELECT public.retry_knowledge_processing_job(
        claim.job_id, claim.lease_token, 'scanner_network_error'
      ) INTO result;
    END LOOP;
  END
  $body$;
  $$,
  'Retryable failures stop after the bounded fifth attempt'
);
SELECT is(
  (
    SELECT status::text FROM public.knowledge_documents
    WHERE id = '4a000000-0000-4000-8000-000000000001'
  ),
  'scan_failed',
  'Retry exhaustion fails the document closed'
);
SELECT is(
  (
    SELECT status::text FROM public.knowledge_processing_jobs
    WHERE document_id = '4a000000-0000-4000-8000-000000000001'
  ),
  'failed',
  'Retry exhaustion terminally fails the queue job'
);
SELECT is(
  (
    SELECT count(*) FROM public.audit_events
    WHERE entity_id = '4a000000-0000-4000-8000-000000000001'
      AND action = 'knowledge.processing_exhausted'
  ),
  1::bigint,
  'Retry exhaustion leaves one immutable audit event'
);

SELECT * FROM finish();
ROLLBACK;
