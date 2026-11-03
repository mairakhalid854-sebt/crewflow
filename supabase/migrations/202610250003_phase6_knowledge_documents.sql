-- CrewFlow Phase 6: quarantined, tenant-scoped knowledge documents.
-- Retrieval is available only after an external service-role scanner has marked
-- the upload clean and a service-role safe parser has supplied bounded chunks.

CREATE TYPE public.knowledge_document_status AS ENUM (
  'quarantined',
  'scan_pending',
  'scan_failed',
  'parse_pending',
  'parse_failed',
  'ready',
  'archived'
);

CREATE TYPE public.knowledge_scan_status AS ENUM (
  'pending',
  'clean',
  'infected',
  'failed'
);

CREATE TYPE public.knowledge_parse_status AS ENUM (
  'pending',
  'succeeded',
  'failed'
);

CREATE TABLE public.knowledge_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  logical_document_id uuid NOT NULL,
  version integer NOT NULL,
  replaces_document_id uuid,
  title text NOT NULL,
  original_file_name text NOT NULL,
  media_type text NOT NULL,
  byte_size bigint NOT NULL,
  storage_path text NOT NULL,
  upload_sha256_claim text,
  content_sha256 text,
  status public.knowledge_document_status NOT NULL DEFAULT 'quarantined',
  scan_status public.knowledge_scan_status NOT NULL DEFAULT 'pending',
  parse_status public.knowledge_parse_status NOT NULL DEFAULT 'pending',
  scanner_name text,
  scanner_version text,
  scan_failure_code text,
  parse_failure_code text,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  uploaded_at timestamptz,
  scanned_at timestamptz,
  parsed_at timestamptz,
  activated_at timestamptz,
  archived_at timestamptz,
  CONSTRAINT knowledge_documents_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT knowledge_documents_logical_version_unique
    UNIQUE (tenant_id, logical_document_id, version),
  CONSTRAINT knowledge_documents_storage_path_unique UNIQUE (storage_path),
  CONSTRAINT knowledge_documents_replacement_tenant_fk
    FOREIGN KEY (replaces_document_id, tenant_id)
    REFERENCES public.knowledge_documents(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT knowledge_documents_version_positive CHECK (version BETWEEN 1 AND 10000),
  CONSTRAINT knowledge_documents_title_length CHECK (char_length(title) BETWEEN 1 AND 160),
  CONSTRAINT knowledge_documents_file_name_length CHECK (
    char_length(original_file_name) BETWEEN 1 AND 240
  ),
  CONSTRAINT knowledge_documents_media_type_allowed CHECK (
    media_type IN (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    )
  ),
  CONSTRAINT knowledge_documents_byte_size_allowed CHECK (
    byte_size BETWEEN 1 AND 10485760
  ),
  CONSTRAINT knowledge_documents_upload_hash_shape CHECK (
    upload_sha256_claim IS NULL OR upload_sha256_claim ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT knowledge_documents_content_hash_shape CHECK (
    content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT knowledge_documents_scanner_length CHECK (
    scanner_name IS NULL OR char_length(scanner_name) BETWEEN 1 AND 80
  ),
  CONSTRAINT knowledge_documents_scanner_version_length CHECK (
    scanner_version IS NULL OR char_length(scanner_version) BETWEEN 1 AND 80
  ),
  CONSTRAINT knowledge_documents_failure_code_length CHECK (
    (scan_failure_code IS NULL OR char_length(scan_failure_code) BETWEEN 1 AND 80)
    AND (parse_failure_code IS NULL OR char_length(parse_failure_code) BETWEEN 1 AND 80)
  ),
  CONSTRAINT knowledge_documents_state_shape CHECK (
    (status = 'quarantined' AND uploaded_at IS NULL AND scanned_at IS NULL)
    OR (status = 'scan_pending' AND uploaded_at IS NOT NULL AND scanned_at IS NULL)
    OR (
      status = 'scan_failed'
      AND uploaded_at IS NOT NULL
      AND scanned_at IS NOT NULL
      AND scan_status IN ('infected', 'failed')
    )
    OR (
      status = 'parse_pending'
      AND scan_status = 'clean'
      AND scanned_at IS NOT NULL
      AND parsed_at IS NULL
    )
    OR (
      status = 'parse_failed'
      AND scan_status = 'clean'
      AND parse_status = 'failed'
      AND parsed_at IS NOT NULL
    )
    OR (
      status = 'ready'
      AND scan_status = 'clean'
      AND parse_status = 'succeeded'
      AND parsed_at IS NOT NULL
      AND activated_at IS NOT NULL
      AND archived_at IS NULL
    )
    OR (status = 'archived' AND archived_at IS NOT NULL)
  )
);

CREATE INDEX knowledge_documents_tenant_status_idx
  ON public.knowledge_documents (tenant_id, status, updated_at DESC);
CREATE INDEX knowledge_documents_logical_idx
  ON public.knowledge_documents (tenant_id, logical_document_id, version DESC);
CREATE INDEX knowledge_documents_content_hash_idx
  ON public.knowledge_documents (tenant_id, content_sha256)
  WHERE content_sha256 IS NOT NULL;

CREATE TABLE public.knowledge_document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  content_sha256 text NOT NULL,
  page_number integer,
  character_start integer,
  character_end integer,
  citation_label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english'::regconfig, content)
  ) STORED,
  CONSTRAINT knowledge_document_chunks_document_tenant_fk
    FOREIGN KEY (document_id, tenant_id)
    REFERENCES public.knowledge_documents(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT knowledge_document_chunks_order_unique UNIQUE (document_id, chunk_index),
  CONSTRAINT knowledge_document_chunks_index_bounds CHECK (chunk_index BETWEEN 1 AND 500),
  CONSTRAINT knowledge_document_chunks_content_length CHECK (
    char_length(content) BETWEEN 1 AND 4000
  ),
  CONSTRAINT knowledge_document_chunks_hash_shape CHECK (
    content_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT knowledge_document_chunks_page_bounds CHECK (
    page_number IS NULL OR page_number BETWEEN 1 AND 100000
  ),
  CONSTRAINT knowledge_document_chunks_character_bounds CHECK (
    (character_start IS NULL AND character_end IS NULL)
    OR (
      character_start BETWEEN 0 AND 100000000
      AND character_end > character_start
      AND character_end <= 100000000
    )
  ),
  CONSTRAINT knowledge_document_chunks_citation_length CHECK (
    char_length(citation_label) BETWEEN 1 AND 240
  )
);

CREATE INDEX knowledge_document_chunks_tenant_document_idx
  ON public.knowledge_document_chunks (tenant_id, document_id, chunk_index);
CREATE INDEX knowledge_document_chunks_search_idx
  ON public.knowledge_document_chunks USING gin (search_vector);

CREATE TABLE public.knowledge_retrieval_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  run_id uuid,
  query_sha256 text NOT NULL,
  selected_chunk_ids uuid[] NOT NULL DEFAULT '{}',
  result_count integer NOT NULL,
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_retrieval_events_run_tenant_fk
    FOREIGN KEY (run_id, tenant_id)
    REFERENCES public.ai_agent_runs(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT knowledge_retrieval_events_query_hash_shape CHECK (
    query_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT knowledge_retrieval_events_result_bounds CHECK (
    result_count BETWEEN 0 AND 20
    AND cardinality(selected_chunk_ids) = result_count
  ),
  CONSTRAINT knowledge_retrieval_events_policy_length CHECK (
    char_length(policy_version) BETWEEN 1 AND 80
  )
);

CREATE INDEX knowledge_retrieval_events_tenant_time_idx
  ON public.knowledge_retrieval_events (tenant_id, created_at DESC);

CREATE TRIGGER knowledge_documents_set_updated_at
BEFORE UPDATE ON public.knowledge_documents
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER knowledge_documents_require_write_entitlement
BEFORE INSERT OR UPDATE OR DELETE ON public.knowledge_documents
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_write_entitlement();

CREATE FUNCTION public.reject_knowledge_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'knowledge evidence is immutable' USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER knowledge_document_chunks_immutable
BEFORE UPDATE OR DELETE ON public.knowledge_document_chunks
FOR EACH ROW EXECUTE FUNCTION public.reject_knowledge_evidence_mutation();

CREATE TRIGGER knowledge_retrieval_events_immutable
BEFORE UPDATE OR DELETE ON public.knowledge_retrieval_events
FOR EACH ROW EXECUTE FUNCTION public.reject_knowledge_evidence_mutation();

ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_retrieval_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY knowledge_documents_read_office ON public.knowledge_documents
FOR SELECT TO authenticated USING (
  public.current_user_has_tenant_role(
    tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  )
);

CREATE POLICY knowledge_retrieval_events_read_office
ON public.knowledge_retrieval_events
FOR SELECT TO authenticated USING (
  public.current_user_has_tenant_role(
    tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  )
);

REVOKE ALL ON public.knowledge_documents FROM anon, authenticated;
REVOKE ALL ON public.knowledge_document_chunks FROM anon, authenticated;
REVOKE ALL ON public.knowledge_retrieval_events FROM anon, authenticated;
GRANT SELECT ON public.knowledge_documents TO authenticated;
GRANT SELECT ON public.knowledge_retrieval_events TO authenticated;

CREATE FUNCTION public.reserve_knowledge_document(
  target_title text,
  target_file_name text,
  target_media_type text,
  target_byte_size bigint,
  target_replaces_document_id uuid DEFAULT NULL
)
RETURNS TABLE (
  document_id uuid,
  storage_path text,
  document_version integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  owner_membership public.memberships%ROWTYPE;
  replaced_document public.knowledge_documents%ROWTYPE;
  new_document_id uuid := gen_random_uuid();
  new_logical_document_id uuid;
  new_version integer;
  file_extension text;
  new_storage_path text;
BEGIN
  SELECT membership.*
  INTO owner_membership
  FROM public.memberships AS membership
  WHERE membership.user_id = auth.uid()
    AND membership.status = 'active'
    AND membership.role = 'owner';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'owner membership required' USING ERRCODE = '42501';
  END IF;

  target_title := pg_catalog.btrim(target_title);
  target_file_name := pg_catalog.btrim(target_file_name);
  target_media_type := pg_catalog.lower(pg_catalog.btrim(target_media_type));

  IF char_length(target_title) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'knowledge document title is invalid' USING ERRCODE = '22023';
  END IF;

  IF char_length(target_file_name) NOT BETWEEN 1 AND 240
    OR target_file_name ~ '[\\/[:cntrl:]]' THEN
    RAISE EXCEPTION 'knowledge document file name is invalid' USING ERRCODE = '22023';
  END IF;

  IF target_byte_size NOT BETWEEN 1 AND 10485760 THEN
    RAISE EXCEPTION 'knowledge document must be between 1 byte and 10 MB'
      USING ERRCODE = '22023';
  END IF;

  file_extension := CASE target_media_type
    WHEN 'application/pdf' THEN 'pdf'
    WHEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' THEN 'docx'
    WHEN 'text/plain' THEN 'txt'
    ELSE NULL
  END;

  IF file_extension IS NULL
    OR pg_catalog.lower(target_file_name) !~ ('[.]' || file_extension || '$') THEN
    RAISE EXCEPTION 'knowledge document type or extension is not allowed'
      USING ERRCODE = '22023';
  END IF;

  IF (
    SELECT count(*)
    FROM public.knowledge_documents AS document
    WHERE document.tenant_id = owner_membership.tenant_id
      AND document.status <> 'archived'
  ) >= 200 THEN
    RAISE EXCEPTION 'knowledge document limit reached' USING ERRCODE = '22023';
  END IF;

  IF target_replaces_document_id IS NULL THEN
    new_logical_document_id := new_document_id;
    new_version := 1;
  ELSE
    SELECT document.*
    INTO replaced_document
    FROM public.knowledge_documents AS document
    WHERE document.id = target_replaces_document_id
      AND document.tenant_id = owner_membership.tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'knowledge document version target not found'
        USING ERRCODE = 'P0002';
    END IF;

    new_logical_document_id := replaced_document.logical_document_id;
    SELECT coalesce(max(document.version), 0) + 1
    INTO new_version
    FROM public.knowledge_documents AS document
    WHERE document.tenant_id = owner_membership.tenant_id
      AND document.logical_document_id = new_logical_document_id;
  END IF;

  new_storage_path := pg_catalog.concat(
    owner_membership.tenant_id, '/', new_logical_document_id,
    '/v', new_version, '/', new_document_id, '.', file_extension
  );

  INSERT INTO public.knowledge_documents (
    id, tenant_id, logical_document_id, version, replaces_document_id,
    title, original_file_name, media_type, byte_size, storage_path,
    created_by_user_id
  ) VALUES (
    new_document_id, owner_membership.tenant_id, new_logical_document_id,
    new_version, target_replaces_document_id, target_title,
    target_file_name, target_media_type, target_byte_size, new_storage_path,
    auth.uid()
  );

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    owner_membership.tenant_id, auth.uid(), 'knowledge.upload_reserved',
    'knowledge_document', new_document_id,
    jsonb_build_object(
      'version', new_version,
      'media_type', target_media_type,
      'byte_size', target_byte_size
    )
  );

  RETURN QUERY SELECT new_document_id, new_storage_path, new_version;
END;
$$;

CREATE FUNCTION public.finalize_knowledge_document_upload(
  target_document_id uuid,
  target_upload_sha256 text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  locked_document public.knowledge_documents%ROWTYPE;
  object_metadata jsonb;
  stored_media_type text;
  stored_size bigint;
BEGIN
  SELECT document.*
  INTO locked_document
  FROM public.knowledge_documents AS document
  WHERE document.id = target_document_id
    AND public.current_user_has_tenant_role(
      document.tenant_id,
      ARRAY['owner']::public.membership_role[]
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'knowledge document reservation not found'
      USING ERRCODE = '42501';
  END IF;

  IF locked_document.status <> 'quarantined' THEN
    IF locked_document.upload_sha256_claim = pg_catalog.lower(target_upload_sha256)
      AND locked_document.uploaded_at IS NOT NULL THEN
      RETURN locked_document.id;
    END IF;
    RAISE EXCEPTION 'knowledge document reservation is no longer open'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.lower(target_upload_sha256) !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'knowledge document SHA-256 is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT object.metadata
  INTO object_metadata
  FROM storage.objects AS object
  WHERE object.bucket_id = 'knowledge-documents'
    AND object.name = locked_document.storage_path;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'knowledge document upload is incomplete' USING ERRCODE = '22023';
  END IF;

  stored_media_type := pg_catalog.lower(coalesce(object_metadata ->> 'mimetype', ''));
  stored_size := nullif(object_metadata ->> 'size', '')::bigint;

  IF stored_media_type <> locked_document.media_type
    OR stored_size IS NULL
    OR stored_size <> locked_document.byte_size THEN
    RAISE EXCEPTION 'knowledge document metadata does not match reservation'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.knowledge_documents
  SET upload_sha256_claim = pg_catalog.lower(target_upload_sha256),
      status = 'scan_pending',
      uploaded_at = now()
  WHERE id = locked_document.id;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    locked_document.tenant_id, auth.uid(), 'knowledge.upload_finalized',
    'knowledge_document', locked_document.id,
    jsonb_build_object('version', locked_document.version)
  );

  RETURN locked_document.id;
END;
$$;

CREATE FUNCTION public.record_knowledge_scan_result(
  target_document_id uuid,
  target_result public.knowledge_scan_status,
  target_content_sha256 text,
  target_scanner_name text,
  target_scanner_version text,
  target_failure_code text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  locked_document public.knowledge_documents%ROWTYPE;
  next_status public.knowledge_document_status;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF target_result NOT IN ('clean', 'infected', 'failed') THEN
    RAISE EXCEPTION 'final scan result required' USING ERRCODE = '22023';
  END IF;

  IF char_length(pg_catalog.btrim(target_scanner_name)) NOT BETWEEN 1 AND 80
    OR char_length(pg_catalog.btrim(target_scanner_version)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'scanner identity is invalid' USING ERRCODE = '22023';
  END IF;

  IF target_result = 'clean'
    AND pg_catalog.lower(target_content_sha256) !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'verified SHA-256 is required for clean documents'
      USING ERRCODE = '22023';
  END IF;

  IF target_result <> 'clean'
    AND (target_failure_code IS NULL OR char_length(target_failure_code) NOT BETWEEN 1 AND 80) THEN
    RAISE EXCEPTION 'bounded scan failure code is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT document.*
  INTO locked_document
  FROM public.knowledge_documents AS document
  WHERE document.id = target_document_id
  FOR UPDATE;

  IF NOT FOUND OR locked_document.status <> 'scan_pending' THEN
    RAISE EXCEPTION 'knowledge document is not awaiting scan'
      USING ERRCODE = '22023';
  END IF;

  next_status := CASE WHEN target_result = 'clean'
    THEN 'parse_pending'::public.knowledge_document_status
    ELSE 'scan_failed'::public.knowledge_document_status
  END;

  UPDATE public.knowledge_documents
  SET scan_status = target_result,
      status = next_status,
      content_sha256 = CASE WHEN target_result = 'clean'
        THEN pg_catalog.lower(target_content_sha256) ELSE NULL END,
      scanner_name = pg_catalog.btrim(target_scanner_name),
      scanner_version = pg_catalog.btrim(target_scanner_version),
      scan_failure_code = CASE WHEN target_result = 'clean'
        THEN NULL ELSE target_failure_code END,
      scanned_at = now()
  WHERE id = locked_document.id;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    locked_document.tenant_id, NULL,
    CASE WHEN target_result = 'clean' THEN 'knowledge.scan_clean'
      ELSE 'knowledge.scan_blocked' END,
    'knowledge_document', locked_document.id,
    jsonb_build_object(
      'scan_status', target_result,
      'scanner_name', pg_catalog.btrim(target_scanner_name),
      'scanner_version', pg_catalog.btrim(target_scanner_version)
    )
  );

  RETURN locked_document.id;
END;
$$;

CREATE FUNCTION public.complete_knowledge_document_parse(
  target_document_id uuid,
  target_chunks jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  locked_document public.knowledge_documents%ROWTYPE;
  chunk_count integer;
  chunk_record record;
  chunk_content text;
  chunk_page integer;
  chunk_start integer;
  chunk_end integer;
  chunk_label text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(target_chunks) <> 'array' THEN
    RAISE EXCEPTION 'knowledge chunks must be an array' USING ERRCODE = '22023';
  END IF;

  chunk_count := jsonb_array_length(target_chunks);
  IF chunk_count NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'knowledge parse must contain between 1 and 500 chunks'
      USING ERRCODE = '22023';
  END IF;

  SELECT document.*
  INTO locked_document
  FROM public.knowledge_documents AS document
  WHERE document.id = target_document_id
  FOR UPDATE;

  IF NOT FOUND OR locked_document.status <> 'parse_pending'
    OR locked_document.scan_status <> 'clean' THEN
    RAISE EXCEPTION 'clean knowledge document is not awaiting parse'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.knowledge_document_chunks AS chunk
    WHERE chunk.document_id = locked_document.id
  ) THEN
    RAISE EXCEPTION 'knowledge document chunks already exist' USING ERRCODE = '22023';
  END IF;

  FOR chunk_record IN
    SELECT value, ordinality
    FROM jsonb_array_elements(target_chunks) WITH ORDINALITY
  LOOP
    chunk_content := pg_catalog.btrim(chunk_record.value ->> 'content');
    chunk_page := nullif(chunk_record.value ->> 'page_number', '')::integer;
    chunk_start := nullif(chunk_record.value ->> 'character_start', '')::integer;
    chunk_end := nullif(chunk_record.value ->> 'character_end', '')::integer;
    chunk_label := pg_catalog.btrim(coalesce(
      chunk_record.value ->> 'citation_label',
      locked_document.original_file_name || ' · chunk ' || chunk_record.ordinality
    ));

    IF char_length(chunk_content) NOT BETWEEN 1 AND 4000
      OR char_length(chunk_label) NOT BETWEEN 1 AND 240
      OR (chunk_page IS NOT NULL AND chunk_page NOT BETWEEN 1 AND 100000)
      OR ((chunk_start IS NULL) <> (chunk_end IS NULL))
      OR (chunk_start IS NOT NULL AND (
        chunk_start NOT BETWEEN 0 AND 100000000
        OR chunk_end <= chunk_start
        OR chunk_end > 100000000
      )) THEN
      RAISE EXCEPTION 'knowledge chunk metadata is invalid' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.knowledge_document_chunks (
      tenant_id, document_id, chunk_index, content, content_sha256,
      page_number, character_start, character_end, citation_label
    ) VALUES (
      locked_document.tenant_id,
      locked_document.id,
      chunk_record.ordinality,
      chunk_content,
      pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(chunk_content, 'UTF8'), 'sha256'),
        'hex'
      ),
      chunk_page,
      chunk_start,
      chunk_end,
      chunk_label
    );
  END LOOP;

  UPDATE public.knowledge_documents
  SET parse_status = 'succeeded',
      status = 'ready',
      parsed_at = now(),
      activated_at = now()
  WHERE id = locked_document.id;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    locked_document.tenant_id, NULL, 'knowledge.parse_completed',
    'knowledge_document', locked_document.id,
    jsonb_build_object('version', locked_document.version, 'chunk_count', chunk_count)
  );

  RETURN locked_document.id;
END;
$$;

CREATE FUNCTION public.fail_knowledge_document_parse(
  target_document_id uuid,
  target_failure_code text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  locked_document public.knowledge_documents%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF char_length(target_failure_code) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'bounded parse failure code is required' USING ERRCODE = '22023';
  END IF;

  SELECT document.*
  INTO locked_document
  FROM public.knowledge_documents AS document
  WHERE document.id = target_document_id
  FOR UPDATE;

  IF NOT FOUND OR locked_document.status <> 'parse_pending' THEN
    RAISE EXCEPTION 'knowledge document is not awaiting parse'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.knowledge_documents
  SET parse_status = 'failed',
      status = 'parse_failed',
      parse_failure_code = target_failure_code,
      parsed_at = now()
  WHERE id = locked_document.id;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    locked_document.tenant_id, NULL, 'knowledge.parse_failed',
    'knowledge_document', locked_document.id,
    jsonb_build_object('failure_code', target_failure_code)
  );

  RETURN locked_document.id;
END;
$$;

CREATE FUNCTION public.archive_knowledge_document(target_document_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  locked_document public.knowledge_documents%ROWTYPE;
BEGIN
  SELECT document.*
  INTO locked_document
  FROM public.knowledge_documents AS document
  WHERE document.id = target_document_id
    AND public.current_user_has_tenant_role(
      document.tenant_id,
      ARRAY['owner']::public.membership_role[]
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'knowledge document not found' USING ERRCODE = '42501';
  END IF;

  IF locked_document.status = 'archived' THEN
    RETURN locked_document.id;
  END IF;

  UPDATE public.knowledge_documents
  SET status = 'archived', archived_at = now()
  WHERE id = locked_document.id;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    locked_document.tenant_id, auth.uid(), 'knowledge.archived',
    'knowledge_document', locked_document.id,
    jsonb_build_object('version', locked_document.version)
  );

  RETURN locked_document.id;
END;
$$;

CREATE FUNCTION public.search_ready_knowledge_chunks(
  target_tenant_id uuid,
  target_run_id uuid,
  target_query text,
  target_policy_version text,
  target_limit integer DEFAULT 8
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  document_title text,
  document_version integer,
  citation_label text,
  page_number integer,
  content text,
  relevance real
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  selected_ids uuid[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF char_length(pg_catalog.btrim(target_query)) NOT BETWEEN 2 AND 500
    OR target_limit NOT BETWEEN 1 AND 20
    OR char_length(target_policy_version) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'knowledge retrieval request is invalid' USING ERRCODE = '22023';
  END IF;

  IF target_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.ai_agent_runs AS run
    WHERE run.id = target_run_id AND run.tenant_id = target_tenant_id
  ) THEN
    RAISE EXCEPTION 'AI run does not belong to tenant' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(array_agg(ranked.id ORDER BY ranked.rank DESC, ranked.id), '{}')
  INTO selected_ids
  FROM (
    SELECT chunk.id, ts_rank_cd(
      chunk.search_vector,
      websearch_to_tsquery('english'::regconfig, target_query)
    ) AS rank
    FROM public.knowledge_document_chunks AS chunk
    JOIN public.knowledge_documents AS document
      ON document.id = chunk.document_id
      AND document.tenant_id = chunk.tenant_id
    WHERE chunk.tenant_id = target_tenant_id
      AND document.status = 'ready'
      AND document.scan_status = 'clean'
      AND document.parse_status = 'succeeded'
      AND chunk.search_vector @@ websearch_to_tsquery('english'::regconfig, target_query)
    ORDER BY rank DESC, chunk.id
    LIMIT target_limit
  ) AS ranked;

  INSERT INTO public.knowledge_retrieval_events (
    tenant_id, run_id, query_sha256, selected_chunk_ids,
    result_count, policy_version
  ) VALUES (
    target_tenant_id,
    target_run_id,
    pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(pg_catalog.btrim(target_query), 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    selected_ids,
    cardinality(selected_ids),
    target_policy_version
  );

  RETURN QUERY
  SELECT
    chunk.id,
    document.id,
    document.title,
    document.version,
    chunk.citation_label,
    chunk.page_number,
    chunk.content,
    ts_rank_cd(
      chunk.search_vector,
      websearch_to_tsquery('english'::regconfig, target_query)
    )
  FROM public.knowledge_document_chunks AS chunk
  JOIN public.knowledge_documents AS document
    ON document.id = chunk.document_id
    AND document.tenant_id = chunk.tenant_id
  WHERE chunk.id = ANY (selected_ids)
  ORDER BY 8 DESC, chunk.id;
END;
$$;

INSERT INTO storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
VALUES (
  'knowledge-documents',
  'knowledge-documents',
  false,
  10485760,
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY knowledge_document_objects_insert_owner
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'knowledge-documents'
  AND EXISTS (
    SELECT 1
    FROM public.knowledge_documents AS document
    WHERE document.storage_path = name
      AND document.status = 'quarantined'
      AND document.created_at > now() - interval '15 minutes'
      AND document.created_by_user_id = auth.uid()
      AND public.current_user_has_tenant_role(
        document.tenant_id,
        ARRAY['owner']::public.membership_role[]
      )
  )
);

REVOKE ALL ON FUNCTION public.reject_knowledge_evidence_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_knowledge_document(text, text, text, bigint, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_knowledge_document(text, text, text, bigint, uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.finalize_knowledge_document_upload(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_knowledge_document_upload(uuid, text)
  TO authenticated;
REVOKE ALL ON FUNCTION public.archive_knowledge_document(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_knowledge_document(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.record_knowledge_scan_result(
  uuid, public.knowledge_scan_status, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_knowledge_scan_result(
  uuid, public.knowledge_scan_status, text, text, text, text
) TO service_role;
REVOKE ALL ON FUNCTION public.complete_knowledge_document_parse(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_knowledge_document_parse(uuid, jsonb)
  TO service_role;
REVOKE ALL ON FUNCTION public.fail_knowledge_document_parse(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_knowledge_document_parse(uuid, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.search_ready_knowledge_chunks(uuid, uuid, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_ready_knowledge_chunks(uuid, uuid, text, text, integer)
  TO service_role;

COMMENT ON TABLE public.knowledge_documents IS
  'Private versioned knowledge uploads; retrieval requires clean scan and successful safe parsing.';
COMMENT ON TABLE public.knowledge_document_chunks IS
  'Immutable, bounded citation chunks created only by the service-role parser boundary.';
COMMENT ON TABLE public.knowledge_retrieval_events IS
  'Immutable retrieval evidence containing query hashes, never raw user queries.';
