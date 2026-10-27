-- CrewFlow Phase 6: durable, bounded OpenAI review for scheduled Follow-Up proposals.
-- The provider reviews only a deterministic proposal and never sends a message.

CREATE TABLE public.ai_provider_review_jobs (
  run_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_provider_review_jobs_run_tenant_fk
    FOREIGN KEY (run_id, tenant_id)
    REFERENCES public.ai_agent_runs(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT ai_provider_review_jobs_status_check
    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  CONSTRAINT ai_provider_review_jobs_attempt_bounds
    CHECK (attempt_count BETWEEN 0 AND 5),
  CONSTRAINT ai_provider_review_jobs_error_length
    CHECK (last_error_code IS NULL OR char_length(last_error_code) BETWEEN 1 AND 80),
  CONSTRAINT ai_provider_review_jobs_state_shape CHECK (
    (status = 'processing' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'processing' AND lease_token IS NULL AND lease_expires_at IS NULL)
  )
);

CREATE INDEX ai_provider_review_jobs_claim_idx
  ON public.ai_provider_review_jobs (status, available_at, created_at)
  WHERE status IN ('queued', 'processing');

CREATE TRIGGER ai_provider_review_jobs_set_updated_at
BEFORE UPDATE ON public.ai_provider_review_jobs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.ai_provider_review_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_provider_review_jobs FROM anon, authenticated;

CREATE FUNCTION public.enqueue_follow_up_provider_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.agent_kind = 'follow_up'
    AND NEW.policy_version = 'follow-up-v1'
    AND NEW.provider = 'stub'
    AND NEW.model = 'deterministic-v1'
    AND NEW.status = 'succeeded' THEN
    INSERT INTO public.ai_provider_review_jobs (run_id, tenant_id)
    VALUES (NEW.id, NEW.tenant_id)
    ON CONFLICT (run_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_agent_runs_enqueue_follow_up_provider_review
AFTER INSERT ON public.ai_agent_runs
FOR EACH ROW EXECUTE FUNCTION public.enqueue_follow_up_provider_review();

INSERT INTO public.ai_provider_review_jobs (run_id, tenant_id)
SELECT run.id, run.tenant_id
FROM public.ai_agent_runs AS run
WHERE run.agent_kind = 'follow_up'
  AND run.policy_version = 'follow-up-v1'
  AND run.provider = 'stub'
  AND run.model = 'deterministic-v1'
  AND run.status = 'succeeded'
  AND EXISTS (
    SELECT 1 FROM public.ai_approval_requests AS approval
    WHERE approval.run_id = run.id
      AND approval.tenant_id = run.tenant_id
      AND approval.status = 'pending'
  )
ON CONFLICT (run_id) DO NOTHING;

CREATE FUNCTION public.claim_follow_up_provider_reviews(
  target_batch_size integer DEFAULT 4
)
RETURNS TABLE (
  run_id uuid,
  lease_token uuid,
  approval_id uuid,
  message_id uuid,
  invoice_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF target_batch_size NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'provider review batch size is invalid' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT job.run_id
    FROM public.ai_provider_review_jobs AS job
    JOIN public.ai_agent_runs AS run
      ON run.id = job.run_id AND run.tenant_id = job.tenant_id
    JOIN public.ai_approval_requests AS approval
      ON approval.run_id = run.id AND approval.tenant_id = run.tenant_id
      AND approval.status = 'pending'
      AND approval.action_kind = 'follow_up.queue_message'
    JOIN public.follow_up_messages AS message
      ON message.id = approval.target_entity_id
      AND message.tenant_id = approval.tenant_id
      AND message.status = 'awaiting_approval'
    WHERE job.attempt_count < 5
      AND job.available_at <= now()
      AND (
        job.status = 'queued'
        OR (job.status = 'processing' AND job.lease_expires_at < now())
      )
      AND run.agent_kind = 'follow_up'
      AND run.policy_version = 'follow-up-v1'
      AND run.provider = 'stub'
      AND run.model = 'deterministic-v1'
      AND run.status = 'succeeded'
    ORDER BY job.created_at, job.run_id
    FOR UPDATE OF job SKIP LOCKED
    LIMIT target_batch_size
  ), claimed AS (
    UPDATE public.ai_provider_review_jobs AS job
    SET status = 'processing',
        attempt_count = job.attempt_count + 1,
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + interval '2 minutes',
        last_error_code = NULL
    FROM candidates
    WHERE job.run_id = candidates.run_id
    RETURNING job.run_id, job.tenant_id, job.lease_token
  )
  SELECT claimed.run_id, claimed.lease_token, approval.id,
    message.id, message.invoice_id
  FROM claimed
  JOIN public.ai_approval_requests AS approval
    ON approval.run_id = claimed.run_id
    AND approval.tenant_id = claimed.tenant_id
    AND approval.status = 'pending'
  JOIN public.follow_up_messages AS message
    ON message.id = approval.target_entity_id
    AND message.tenant_id = approval.tenant_id;
END;
$$;

CREATE FUNCTION public.retry_follow_up_provider_review(
  target_run_id uuid,
  target_lease_token uuid,
  target_error_code text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE locked_job public.ai_provider_review_jobs%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF target_error_code IS NULL
    OR target_error_code !~ '^[a-z0-9_]{3,80}$' THEN
    RAISE EXCEPTION 'bounded provider review error code required'
      USING ERRCODE = '22023';
  END IF;

  SELECT job.* INTO locked_job
  FROM public.ai_provider_review_jobs AS job
  WHERE job.run_id = target_run_id
    AND job.status = 'processing'
    AND job.lease_token = target_lease_token
    AND job.lease_expires_at >= now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'provider review lease is invalid' USING ERRCODE = '42501';
  END IF;

  UPDATE public.ai_provider_review_jobs
  SET status = CASE WHEN locked_job.attempt_count >= 5 THEN 'failed' ELSE 'queued' END,
      available_at = now() + make_interval(
        mins => least(240, 5 * (2 ^ greatest(0, locked_job.attempt_count - 1))::integer)
      ),
      lease_token = NULL,
      lease_expires_at = NULL,
      last_error_code = target_error_code
  WHERE run_id = locked_job.run_id;

  RETURN CASE WHEN locked_job.attempt_count >= 5 THEN 'failed' ELSE 'queued' END;
END;
$$;

CREATE FUNCTION public.record_follow_up_provider_review(
  target_run_id uuid,
  target_lease_token uuid,
  target_model text,
  target_input_tokens integer,
  target_output_tokens integer,
  target_estimated_cost_cents integer,
  target_duration_ms integer,
  target_redacted_summary text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  locked_job public.ai_provider_review_jobs%ROWTYPE;
  locked_run public.ai_agent_runs%ROWTYPE;
  next_sequence integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF target_run_id IS NULL OR target_lease_token IS NULL
    OR target_model IS NULL OR target_model <> 'gpt-6-luna'
    OR target_input_tokens IS NULL
    OR target_input_tokens NOT BETWEEN 0 AND 4000
    OR target_output_tokens IS NULL
    OR target_output_tokens NOT BETWEEN 0 AND 300
    OR target_estimated_cost_cents IS NULL
    OR target_estimated_cost_cents NOT BETWEEN 0 AND 2
    OR target_duration_ms IS NULL
    OR target_duration_ms NOT BETWEEN 0 AND 30000
    OR target_redacted_summary IS NULL
    OR char_length(target_redacted_summary) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid Follow-Up provider review' USING ERRCODE = '22023';
  END IF;

  SELECT job.* INTO locked_job
  FROM public.ai_provider_review_jobs AS job
  WHERE job.run_id = target_run_id
    AND job.status = 'processing'
    AND job.lease_token = target_lease_token
    AND job.lease_expires_at >= now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'provider review lease is invalid' USING ERRCODE = '42501';
  END IF;

  SELECT run.* INTO locked_run
  FROM public.ai_agent_runs AS run
  WHERE run.id = locked_job.run_id
    AND run.tenant_id = locked_job.tenant_id
    AND run.actor_user_id IS NULL
    AND run.agent_kind = 'follow_up'
    AND run.policy_version = 'follow-up-v1'
    AND run.status = 'succeeded'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Follow-Up run is unavailable' USING ERRCODE = '42501';
  END IF;

  IF locked_run.provider = 'openai' AND locked_run.model = target_model THEN
    UPDATE public.ai_provider_review_jobs
    SET status = 'completed', lease_token = NULL, lease_expires_at = NULL
    WHERE run_id = locked_run.id;
    RETURN false;
  END IF;
  IF locked_run.provider <> 'stub' OR locked_run.model <> 'deterministic-v1' THEN
    RAISE EXCEPTION 'Follow-Up provider review conflict' USING ERRCODE = '23505';
  END IF;

  UPDATE public.ai_agent_runs
  SET provider = 'openai', model = target_model,
      input_tokens = target_input_tokens, output_tokens = target_output_tokens,
      estimated_cost_cents = target_estimated_cost_cents,
      duration_ms = target_duration_ms
  WHERE id = locked_run.id;

  SELECT coalesce(max(step.sequence_number), 0) + 1 INTO next_sequence
  FROM public.ai_run_steps AS step
  WHERE step.run_id = locked_run.id AND step.tenant_id = locked_run.tenant_id;

  INSERT INTO public.ai_run_steps (
    tenant_id, run_id, sequence_number, step_kind, redacted_summary,
    outcome, duration_ms
  ) VALUES (
    locked_run.tenant_id, locked_run.id, next_sequence, 'provider_review',
    target_redacted_summary, 'provider_reviewed', target_duration_ms
  );
  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id,
    correlation_id, metadata
  ) VALUES (
    locked_run.tenant_id, NULL, 'ai.follow_up_provider_reviewed',
    'ai_agent_run', locked_run.id, locked_run.correlation_id,
    jsonb_build_object(
      'provider', 'openai', 'model', target_model,
      'input_tokens', target_input_tokens, 'output_tokens', target_output_tokens,
      'estimated_cost_cents', target_estimated_cost_cents,
      'duration_ms', target_duration_ms
    )
  );
  UPDATE public.ai_provider_review_jobs
  SET status = 'completed', lease_token = NULL, lease_expires_at = NULL,
      last_error_code = NULL
  WHERE run_id = locked_run.id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.configure_follow_up_provider_review_cron()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE existing_job_id bigint; scheduled_job_id bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND session_user <> 'postgres' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'crewflow_project_url')
    OR NOT EXISTS (
      SELECT 1 FROM vault.secrets
      WHERE name = 'crewflow_edge_function_service_key'
    ) THEN
    RAISE EXCEPTION 'shared CrewFlow cron secrets are not configured'
      USING ERRCODE = '55000';
  END IF;

  SELECT jobid INTO existing_job_id FROM cron.job
  WHERE jobname = 'crewflow-review-follow-up-proposals' LIMIT 1;
  IF existing_job_id IS NOT NULL THEN PERFORM cron.unschedule(existing_job_id); END IF;

  SELECT cron.schedule(
    'crewflow-review-follow-up-proposals', '*/5 * * * *',
    $command$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'crewflow_project_url') ||
          '/functions/v1/process-follow-up-openai-reviews',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'crewflow_edge_function_service_key')
        ),
        body := jsonb_build_object('scheduled_at', now()),
        timeout_milliseconds := 45000
      ) AS request_id;
    $command$
  ) INTO scheduled_job_id;
  RETURN scheduled_job_id;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'crewflow_project_url')
    AND EXISTS (
      SELECT 1 FROM vault.secrets
      WHERE name = 'crewflow_edge_function_service_key'
    ) THEN
    PERFORM public.configure_follow_up_provider_review_cron();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_follow_up_provider_review() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_follow_up_provider_reviews(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_follow_up_provider_reviews(integer)
  TO service_role;
REVOKE ALL ON FUNCTION public.retry_follow_up_provider_review(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retry_follow_up_provider_review(uuid, uuid, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.record_follow_up_provider_review(
  uuid, uuid, text, integer, integer, integer, integer, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_follow_up_provider_review(
  uuid, uuid, text, integer, integer, integer, integer, text
) TO service_role;
REVOKE ALL ON FUNCTION public.configure_follow_up_provider_review_cron()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_follow_up_provider_review_cron()
  TO service_role;
