BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(30);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '19000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'knowledge-owner-a@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '19000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'knowledge-owner-b@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '19000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
    'knowledge-tech-a@crewflow.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

INSERT INTO public.tenants (
  id, legal_name, display_name, business_email, time_zone, service_categories
) VALUES
  (
    '29000000-0000-4000-8000-000000000001', 'Knowledge Tenant A LLC',
    'Knowledge Tenant A', 'knowledge-a@crewflow.test', 'America/Chicago', ARRAY['Cleaning']
  ),
  (
    '29000000-0000-4000-8000-000000000002', 'Knowledge Tenant B LLC',
    'Knowledge Tenant B', 'knowledge-b@crewflow.test', 'America/New_York', ARRAY['HVAC']
  );

INSERT INTO public.memberships (id, tenant_id, user_id, role, status, joined_at)
VALUES
  (
    '39000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000001',
    '19000000-0000-4000-8000-000000000001', 'owner', 'active', now()
  ),
  (
    '39000000-0000-4000-8000-000000000002',
    '29000000-0000-4000-8000-000000000002',
    '19000000-0000-4000-8000-000000000002', 'owner', 'active', now()
  ),
  (
    '39000000-0000-4000-8000-000000000003',
    '29000000-0000-4000-8000-000000000001',
    '19000000-0000-4000-8000-000000000003', 'technician', 'active', now()
  );

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"19000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

SELECT lives_ok(
  $$SELECT set_config(
    'crewflow.knowledge_reservation', row_to_json(reservation)::text, true
  )
  FROM public.reserve_knowledge_document(
    'Gutter cleaning policy', 'gutter-policy.pdf', 'application/pdf', 1000, NULL
  ) AS reservation$$,
  'Owner can reserve an allowed private knowledge upload'
);
SELECT matches(
  current_setting('crewflow.knowledge_reservation')::jsonb ->> 'storage_path',
  '^29000000-0000-4000-8000-000000000001/[0-9a-f-]+/v1/[0-9a-f-]+[.]pdf$',
  'Reservation path is tenant, logical-document, and version scoped'
);
SELECT is(
  (SELECT status::text FROM public.knowledge_documents LIMIT 1),
  'quarantined',
  'Reserved upload remains quarantined'
);
SELECT throws_ok(
  $$SELECT public.reserve_knowledge_document(
    'Executable', 'payload.exe', 'application/octet-stream', 10, NULL
  )$$,
  '22023',
  'knowledge document type or extension is not allowed',
  'Disallowed content types are rejected'
);
SELECT throws_ok(
  $$INSERT INTO public.knowledge_documents (
    tenant_id, logical_document_id, version, title, original_file_name,
    media_type, byte_size, storage_path, created_by_user_id
  ) VALUES (
    '29000000-0000-4000-8000-000000000001', gen_random_uuid(), 1,
    'Bypass', 'bypass.txt', 'text/plain', 10, 'bypass/path.txt',
    '19000000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  'permission denied for table knowledge_documents',
  'Browser users cannot bypass the reservation command'
);
SELECT lives_ok(
  format(
    $sql$INSERT INTO storage.objects (bucket_id, name, metadata)
      VALUES ('knowledge-documents', %L, '{"mimetype":"application/pdf","size":1000}'::jsonb)$sql$,
    current_setting('crewflow.knowledge_reservation')::jsonb ->> 'storage_path'
  ),
  'Owner can upload only to the live reserved path'
);
SELECT lives_ok(
  format(
    'SELECT public.finalize_knowledge_document_upload(%L::uuid, %L)',
    current_setting('crewflow.knowledge_reservation')::jsonb ->> 'document_id',
    repeat('a', 64)
  ),
  'Owner can finalize matching object metadata'
);
SELECT throws_ok(
  format(
    'SELECT public.record_knowledge_scan_result(%L::uuid, %L, %L, %L, %L, NULL)',
    current_setting('crewflow.knowledge_reservation')::jsonb ->> 'document_id',
    'clean', repeat('b', 64), 'test-scanner', '1.0'
  ),
  '42501',
  'permission denied for function record_knowledge_scan_result',
  'Browser owner cannot forge a clean scan result'
);
SELECT is(
  (SELECT status::text FROM public.knowledge_documents LIMIT 1),
  'scan_pending',
  'Finalized upload waits for malware scanning'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT lives_ok(
  format(
    'SELECT public.record_knowledge_scan_result(%L::uuid, %L, %L, %L, %L, NULL)',
    current_setting('crewflow.knowledge_reservation')::jsonb ->> 'document_id',
    'clean', repeat('b', 64), 'test-scanner', '1.0'
  ),
  'Service scanner can mark a pending upload clean'
);
SELECT is(
  (
    SELECT status::text || ':' || scan_status::text
    FROM public.knowledge_documents
    WHERE id = (current_setting('crewflow.knowledge_reservation')::jsonb ->> 'document_id')::uuid
  ),
  'parse_pending:clean',
  'Clean scan advances only to parse pending'
);
SELECT lives_ok(
  format(
    $sql$SELECT public.complete_knowledge_document_parse(
      %L::uuid,
      '[{"content":"Gutter cleaning removes leaves and prevents water damage.","page_number":1,"citation_label":"Gutter policy · page 1"},{"content":"Technicians inspect downspouts after cleaning.","page_number":2,"citation_label":"Gutter policy · page 2"}]'::jsonb
    )$sql$,
    current_setting('crewflow.knowledge_reservation')::jsonb ->> 'document_id'
  ),
  'Safe parser can add bounded citation chunks'
);
SELECT is(
  (
    SELECT status::text || ':' || parse_status::text
    FROM public.knowledge_documents
    WHERE id = (current_setting('crewflow.knowledge_reservation')::jsonb ->> 'document_id')::uuid
  ),
  'ready:succeeded',
  'Only clean successfully parsed document becomes ready'
);
SELECT is(
  (
    SELECT count(*) FROM public.knowledge_document_chunks
    WHERE document_id = (current_setting('crewflow.knowledge_reservation')::jsonb ->> 'document_id')::uuid
  ),
  2::bigint,
  'Parser created the expected bounded chunks'
);
SELECT lives_ok(
  $$SELECT set_config(
    'crewflow.knowledge_search', coalesce(jsonb_agg(row_to_json(result)), '[]')::text, true
  ) FROM public.search_ready_knowledge_chunks(
    '29000000-0000-4000-8000-000000000001', NULL,
    'gutter cleaning leaves', 'knowledge-v1', 8
  ) AS result$$,
  'Service retrieval can search ready tenant chunks'
);
SELECT is(
  jsonb_array_length(current_setting('crewflow.knowledge_search')::jsonb),
  1,
  'Relevant ready chunk is returned'
);
SELECT is(
  current_setting('crewflow.knowledge_search')::jsonb -> 0 ->> 'citation_label',
  'Gutter policy · page 1',
  'Retrieval result carries its source citation'
);
SELECT is(
  (SELECT count(*) FROM public.knowledge_retrieval_events),
  1::bigint,
  'Retrieval writes one immutable evidence event'
);
SELECT isnt(
  (SELECT query_sha256 FROM public.knowledge_retrieval_events LIMIT 1),
  'gutter cleaning leaves',
  'Retrieval evidence stores a query hash, not raw query text'
);
SELECT throws_ok(
  $$UPDATE public.knowledge_document_chunks SET content = 'tampered'$$,
  '42501',
  'knowledge evidence is immutable',
  'Citation chunks cannot be changed after parsing'
);
SELECT throws_ok(
  $$DELETE FROM public.knowledge_retrieval_events$$,
  '42501',
  'knowledge evidence is immutable',
  'Retrieval evidence cannot be deleted'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"19000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
SELECT is(
  (SELECT count(*) FROM public.knowledge_documents),
  0::bigint,
  'Another tenant cannot read knowledge document metadata'
);
SELECT throws_ok(
  format(
    'SELECT public.reserve_knowledge_document(%L, %L, %L, %s, %L::uuid)',
    'Stolen version', 'stolen.pdf', 'application/pdf', 1000,
    current_setting('crewflow.knowledge_reservation')::jsonb ->> 'document_id'
  ),
  'P0002',
  'knowledge document version target not found',
  'Another tenant cannot create a version from foreign metadata'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"19000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
SELECT is(
  (SELECT count(*) FROM public.knowledge_documents),
  0::bigint,
  'Technicians cannot inspect tenant knowledge metadata'
);
SELECT throws_ok(
  $$SELECT public.reserve_knowledge_document(
    'Technician upload', 'notes.txt', 'text/plain', 10, NULL
  )$$,
  '42501',
  'owner membership required',
  'Technicians cannot reserve knowledge uploads'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"19000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT lives_ok(
  format(
    $sql$SELECT set_config(
      'crewflow.knowledge_replacement', row_to_json(reservation)::text, true
    ) FROM public.reserve_knowledge_document(
      'Gutter cleaning policy', 'gutter-policy-v2.pdf', 'application/pdf', 1200, %L::uuid
    ) AS reservation$sql$,
    current_setting('crewflow.knowledge_reservation')::jsonb ->> 'document_id'
  ),
  'Owner can reserve a replacement version'
);
SELECT is(
  (current_setting('crewflow.knowledge_replacement')::jsonb ->> 'document_version')::integer,
  2,
  'Replacement receives the next document version'
);
SELECT lives_ok(
  format(
    'SELECT public.archive_knowledge_document(%L::uuid)',
    current_setting('crewflow.knowledge_reservation')::jsonb ->> 'document_id'
  ),
  'Owner can archive a ready document'
);
SELECT is(
  (
    SELECT status::text FROM public.knowledge_documents
    WHERE id = (current_setting('crewflow.knowledge_reservation')::jsonb ->> 'document_id')::uuid
  ),
  'archived',
  'Archived document is retained with an explicit state'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT is(
  (
    SELECT count(*) FROM public.search_ready_knowledge_chunks(
      '29000000-0000-4000-8000-000000000001', NULL,
      'gutter cleaning leaves', 'knowledge-v1', 8
    )
  ),
  0::bigint,
  'Archived versions are excluded from retrieval'
);

SELECT * FROM finish();
ROLLBACK;
