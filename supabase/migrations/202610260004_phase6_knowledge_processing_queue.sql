-- CrewFlow Phase 6: durable, fail-closed knowledge scan and parse processing.
-- Browser users can observe document state but cannot claim or complete jobs.

CREATE TYPE public.knowledge_processing_stage AS ENUM ('scan', 'parse');
CREATE TYPE public.knowledge_processing_job_status AS ENUM (
  'queued',
  'processing',
  'completed',
  'failed',
  'cancelled'
);

CREATE TABLE public.knowledge_processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL,
  stage public.knowledge_processing_stage NOT NULL,
  status public.knowledge_processing_job_status NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT knowledge_processing_jobs_document_tenant_fk
    FOREIGN KEY (document_id, tenant_id)
    REFERENCES public.knowledge_documents(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT knowledge_processing_jobs_document_stage_unique
    UNIQUE (document_id, stage),
  CONSTRAINT knowledge_processing_jobs_attempt_bounds
    CHECK (attempt_count BETWEEN 0 AND 5),
  CONSTRAINT knowledge_processing_jobs_error_length
    CHECK (last_error_code IS NULL OR char_length(last_error_code) BETWEEN 1 AND 80),
  CONSTRAINT knowledge_processing_jobs_state_shape CHECK (
    (
      status = 'queued'
      AND lease_token IS NULL
      AND lease_expires_at IS NULL
      AND completed_at IS NULL
    )
    OR (
      status = 'processing'
      AND lease_token IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND completed_at IS NULL
    )
    OR (
      status IN ('completed', 'failed', 'cancelled')
      AND lease_token IS NULL
      AND lease_expires_at IS NULL
      AND completed_at IS NOT NULL
    )
  )
);

CREATE INDEX knowledge_processing_jobs_claim_idx
  ON public.knowledge_processing_jobs (status, available_at, created_at)
  WHERE status IN ('queued', 'processing');

CREATE TRIGGER knowledge_processing_jobs_set_updated_at
BEFORE UPDATE ON public.knowledge_processing_jobs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.knowledge_processing_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.knowledge_processing_jobs FROM anon, authenticated;

CREATE FUNCTION public.enqueue_knowledge_document_processing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE target_stage public.knowledge_processing_stage;
BEGIN
  IF NEW.status = 'archived' THEN
    UPDATE public.knowledge_processing_jobs
    SET status = 'cancelled', lease_token = NULL, lease_expires_at = NULL,
        completed_at = now(), last_error_code = 'document_archived'
    WHERE document_id = NEW.id
      AND status IN ('queued', 'processing');
    RETURN NEW;
  END IF;

  target_stage := CASE NEW.status
    WHEN 'scan_pending' THEN 'scan'::public.knowledge_processing_stage
    WHEN 'parse_pending' THEN 'parse'::public.knowledge_processing_stage
    ELSE NULL
  END;

  IF target_stage IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.knowledge_processing_jobs (
    tenant_id, document_id, stage
  ) VALUES (
    NEW.tenant_id, NEW.id, target_stage
  ) ON CONFLICT (document_id, stage) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER knowledge_documents_enqueue_processing
AFTER UPDATE OF status ON public.knowledge_documents
FOR EACH ROW EXECUTE FUNCTION public.enqueue_knowledge_document_processing();

-- Backfill an upload that reached a pending state before this queue existed.
INSERT INTO public.knowledge_processing_jobs (tenant_id, document_id, stage)
SELECT document.tenant_id, document.id,
  CASE document.status
    WHEN 'scan_pending' THEN 'scan'::public.knowledge_processing_stage
    ELSE 'parse'::public.knowledge_processing_stage
  END
FROM public.knowledge_documents AS document
WHERE document.status IN ('scan_pending', 'parse_pending')
ON CONFLICT (document_id, stage) DO NOTHING;

CREATE FUNCTION public.claim_knowledge_processing_jobs(target_batch_size integer DEFAULT 4)
RETURNS TABLE (
  job_id uuid,
  lease_token uuid,
  stage public.knowledge_processing_stage,
  attempt_count integer,
  document_id uuid,
  tenant_id uuid,
  storage_path text,
  original_file_name text,
  media_type text,
  byte_size bigint,
  upload_sha256_claim text,
  content_sha256 text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE exhausted_job record;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF target_batch_size NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'knowledge processing batch size is invalid'
      USING ERRCODE = '22023';
  END IF;

  -- A worker may disappear after its final claim. Close those expired leases
  -- before looking for more work so no document remains pending forever.
  FOR exhausted_job IN
    SELECT job.*
    FROM public.knowledge_processing_jobs AS job
    WHERE job.status = 'processing'
      AND job.lease_expires_at <= now()
      AND job.attempt_count >= 5
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.knowledge_processing_jobs
    SET status = 'failed', lease_token = NULL, lease_expires_at = NULL,
        completed_at = now(),
        last_error_code = coalesce(last_error_code, 'worker_lease_expired')
    WHERE id = exhausted_job.id;

    IF exhausted_job.stage = 'scan' THEN
      UPDATE public.knowledge_documents
      SET status = 'scan_failed', scan_status = 'failed',
          scan_failure_code = 'worker_lease_expired', scanned_at = now()
      WHERE id = exhausted_job.document_id AND status = 'scan_pending';
    ELSE
      UPDATE public.knowledge_documents
      SET status = 'parse_failed', parse_status = 'failed',
          parse_failure_code = 'worker_lease_expired', parsed_at = now()
      WHERE id = exhausted_job.document_id AND status = 'parse_pending';
    END IF;

    INSERT INTO public.audit_events (
      tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
      exhausted_job.tenant_id, NULL, 'knowledge.processing_exhausted',
      'knowledge_document', exhausted_job.document_id,
      jsonb_build_object(
        'stage', exhausted_job.stage,
        'attempt_count', exhausted_job.attempt_count,
        'error_code', 'worker_lease_expired'
      )
    );
  END LOOP;

  RETURN QUERY
  WITH candidates AS (
    SELECT job.id
    FROM public.knowledge_processing_jobs AS job
    JOIN public.knowledge_documents AS document
      ON document.id = job.document_id
      AND document.tenant_id = job.tenant_id
    WHERE job.attempt_count < 5
      AND (
        (job.status = 'queued' AND job.available_at <= now())
        OR (job.status = 'processing' AND job.lease_expires_at <= now())
      )
      AND (
        (job.stage = 'scan' AND document.status = 'scan_pending')
        OR (job.stage = 'parse' AND document.status = 'parse_pending')
      )
    ORDER BY job.available_at, job.created_at
    FOR UPDATE OF job SKIP LOCKED
    LIMIT target_batch_size
  ), claimed AS (
    UPDATE public.knowledge_processing_jobs AS job
    SET status = 'processing',
        attempt_count = job.attempt_count + 1,
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + interval '5 minutes',
        last_error_code = NULL
    FROM candidates
    WHERE job.id = candidates.id
    RETURNING job.*
  )
  SELECT claimed.id, claimed.lease_token, claimed.stage,
    claimed.attempt_count, document.id, document.tenant_id,
    document.storage_path, document.original_file_name, document.media_type,
    document.byte_size, document.upload_sha256_claim, document.content_sha256
  FROM claimed
  JOIN public.knowledge_documents AS document
    ON document.id = claimed.document_id
    AND document.tenant_id = claimed.tenant_id;
END;
$$;

CREATE FUNCTION public.finish_knowledge_scan_job(
  target_job_id uuid,
  target_lease_token uuid,
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
DECLARE locked_job public.knowledge_processing_jobs%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  SELECT job.* INTO locked_job
  FROM public.knowledge_processing_jobs AS job
  WHERE job.id = target_job_id
  FOR UPDATE;

  IF NOT FOUND OR locked_job.stage <> 'scan'
    OR locked_job.status <> 'processing'
    OR locked_job.lease_token <> target_lease_token THEN
    RAISE EXCEPTION 'knowledge scan lease is invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM public.record_knowledge_scan_result(
    locked_job.document_id, target_result, target_content_sha256,
    target_scanner_name, target_scanner_version, target_failure_code
  );

  PERFORM public.complete_knowledge_processing_job(
    locked_job.id, target_lease_token
  );
  RETURN locked_job.document_id;
END;
$$;

CREATE FUNCTION public.finish_knowledge_parse_job(
  target_job_id uuid,
  target_lease_token uuid,
  target_chunks jsonb DEFAULT NULL,
  target_failure_code text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE locked_job public.knowledge_processing_jobs%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  SELECT job.* INTO locked_job
  FROM public.knowledge_processing_jobs AS job
  WHERE job.id = target_job_id
  FOR UPDATE;

  IF NOT FOUND OR locked_job.stage <> 'parse'
    OR locked_job.status <> 'processing'
    OR locked_job.lease_token <> target_lease_token THEN
    RAISE EXCEPTION 'knowledge parse lease is invalid' USING ERRCODE = '22023';
  END IF;

  IF (target_chunks IS NULL) = (target_failure_code IS NULL) THEN
    RAISE EXCEPTION 'exactly one parse outcome is required' USING ERRCODE = '22023';
  END IF;

  IF target_failure_code IS NULL THEN
    PERFORM public.complete_knowledge_document_parse(
      locked_job.document_id, target_chunks
    );
  ELSE
    PERFORM public.fail_knowledge_document_parse(
      locked_job.document_id, target_failure_code
    );
  END IF;

  PERFORM public.complete_knowledge_processing_job(
    locked_job.id, target_lease_token
  );
  RETURN locked_job.document_id;
END;
$$;

CREATE FUNCTION public.complete_knowledge_processing_job(
  target_job_id uuid,
  target_lease_token uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE locked_job public.knowledge_processing_jobs%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  SELECT job.* INTO locked_job
  FROM public.knowledge_processing_jobs AS job
  WHERE job.id = target_job_id
  FOR UPDATE;

  IF NOT FOUND OR locked_job.status <> 'processing'
    OR locked_job.lease_token <> target_lease_token THEN
    RAISE EXCEPTION 'knowledge processing lease is invalid'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.knowledge_processing_jobs
  SET status = 'completed', lease_token = NULL, lease_expires_at = NULL,
      completed_at = now(), last_error_code = NULL
  WHERE id = locked_job.id;

  RETURN locked_job.id;
END;
$$;

CREATE FUNCTION public.retry_knowledge_processing_job(
  target_job_id uuid,
  target_lease_token uuid,
  target_error_code text
)
RETURNS public.knowledge_processing_job_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  locked_job public.knowledge_processing_jobs%ROWTYPE;
  terminal boolean;
  bounded_error text := pg_catalog.btrim(target_error_code);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF char_length(bounded_error) NOT BETWEEN 1 AND 80
    OR bounded_error !~ '^[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'bounded knowledge processing error code required'
      USING ERRCODE = '22023';
  END IF;

  SELECT job.* INTO locked_job
  FROM public.knowledge_processing_jobs AS job
  WHERE job.id = target_job_id
  FOR UPDATE;

  IF NOT FOUND OR locked_job.status <> 'processing'
    OR locked_job.lease_token <> target_lease_token THEN
    RAISE EXCEPTION 'knowledge processing lease is invalid'
      USING ERRCODE = '22023';
  END IF;

  terminal := locked_job.attempt_count >= 5;

  UPDATE public.knowledge_processing_jobs
  SET status = CASE WHEN terminal
        THEN 'failed'::public.knowledge_processing_job_status
        ELSE 'queued'::public.knowledge_processing_job_status
      END,
      available_at = CASE WHEN terminal THEN available_at ELSE
        now() + (interval '1 minute' * least(60, power(2, locked_job.attempt_count - 1)::integer))
      END,
      lease_token = NULL,
      lease_expires_at = NULL,
      last_error_code = bounded_error,
      completed_at = CASE WHEN terminal THEN now() ELSE NULL END
  WHERE id = locked_job.id;

  IF terminal AND locked_job.stage = 'scan' THEN
    UPDATE public.knowledge_documents
    SET status = 'scan_failed', scan_status = 'failed',
        scan_failure_code = bounded_error, scanned_at = now()
    WHERE id = locked_job.document_id AND status = 'scan_pending';
  ELSIF terminal AND locked_job.stage = 'parse' THEN
    UPDATE public.knowledge_documents
    SET status = 'parse_failed', parse_status = 'failed',
        parse_failure_code = bounded_error, parsed_at = now()
    WHERE id = locked_job.document_id AND status = 'parse_pending';
  END IF;

  IF terminal THEN
    INSERT INTO public.audit_events (
      tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
      locked_job.tenant_id, NULL, 'knowledge.processing_exhausted',
      'knowledge_document', locked_job.document_id,
      jsonb_build_object(
        'stage', locked_job.stage,
        'attempt_count', locked_job.attempt_count,
        'error_code', bounded_error
      )
    );
  END IF;

  RETURN CASE WHEN terminal
    THEN 'failed'::public.knowledge_processing_job_status
    ELSE 'queued'::public.knowledge_processing_job_status
  END;
END;
$$;

CREATE FUNCTION public.configure_knowledge_processing_cron()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE existing_job_id bigint; scheduled_job_id bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vault.secrets WHERE name = 'crewflow_project_url'
  ) OR NOT EXISTS (
    SELECT 1 FROM vault.secrets WHERE name = 'crewflow_edge_function_service_key'
  ) THEN
    RAISE EXCEPTION 'shared CrewFlow cron secrets are not configured'
      USING ERRCODE = '55000';
  END IF;

  SELECT jobid INTO existing_job_id
  FROM cron.job WHERE jobname = 'crewflow-process-knowledge-documents' LIMIT 1;
  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  SELECT cron.schedule(
    'crewflow-process-knowledge-documents',
    '* * * * *',
    $command$
      SELECT net.http_post(
        url := (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'crewflow_project_url'
        ) || '/functions/v1/process-knowledge-documents',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (
            SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'crewflow_edge_function_service_key'
          )
        ),
        body := jsonb_build_object('scheduled_at', now()),
        timeout_milliseconds := 45000
      ) AS request_id;
    $command$
  ) INTO scheduled_job_id;

  RETURN scheduled_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_knowledge_document_processing() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_knowledge_processing_jobs(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_knowledge_processing_jobs(integer)
  TO service_role;
REVOKE ALL ON FUNCTION public.complete_knowledge_processing_job(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_knowledge_scan_job(
  uuid, uuid, public.knowledge_scan_status, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_knowledge_scan_job(
  uuid, uuid, public.knowledge_scan_status, text, text, text, text
) TO service_role;
REVOKE ALL ON FUNCTION public.finish_knowledge_parse_job(uuid, uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_knowledge_parse_job(uuid, uuid, jsonb, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.retry_knowledge_processing_job(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retry_knowledge_processing_job(uuid, uuid, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.configure_knowledge_processing_cron()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_knowledge_processing_cron()
  TO service_role;

COMMENT ON TABLE public.knowledge_processing_jobs IS
  'Private durable scan/parse queue. Content never becomes retrievable unless both stages succeed.';
COMMENT ON FUNCTION public.claim_knowledge_processing_jobs(integer) IS
  'Service-only bounded claim with expiring leases and at most five attempts.';
