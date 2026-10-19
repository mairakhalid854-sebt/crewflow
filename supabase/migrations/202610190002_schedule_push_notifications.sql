-- CrewFlow Phase 4: configure the push delivery worker through pg_cron and
-- pg_net while keeping the Edge Function secret encrypted in Supabase Vault.

CREATE FUNCTION public.configure_push_notification_cron(
  target_project_url text,
  target_service_key text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  project_url_secret_id uuid;
  service_key_secret_id uuid;
  scheduled_job_id bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF target_project_url IS NULL
    OR target_project_url !~ '^https://[a-z0-9]{20}\.supabase\.co$'
  THEN
    RAISE EXCEPTION 'valid Supabase project URL required'
      USING ERRCODE = '22023';
  END IF;

  IF target_service_key IS NULL
    OR target_service_key <> trim(target_service_key)
    OR char_length(target_service_key) NOT BETWEEN 40 AND 4096
  THEN
    RAISE EXCEPTION 'valid Edge Function service key required'
      USING ERRCODE = '22023';
  END IF;

  SELECT secret.id
  INTO project_url_secret_id
  FROM vault.secrets AS secret
  WHERE secret.name = 'crewflow_project_url'
  LIMIT 1;

  IF project_url_secret_id IS NULL THEN
    SELECT vault.create_secret(
      target_project_url,
      'crewflow_project_url',
      'CrewFlow project URL used only by scheduled database workers.'
    ) INTO project_url_secret_id;
  ELSE
    PERFORM vault.update_secret(
      project_url_secret_id,
      target_project_url,
      'crewflow_project_url',
      'CrewFlow project URL used only by scheduled database workers.'
    );
  END IF;

  SELECT secret.id
  INTO service_key_secret_id
  FROM vault.secrets AS secret
  WHERE secret.name = 'crewflow_edge_function_service_key'
  LIMIT 1;

  IF service_key_secret_id IS NULL THEN
    SELECT vault.create_secret(
      target_service_key,
      'crewflow_edge_function_service_key',
      'Secret API key used only by scheduled CrewFlow Edge Functions.'
    ) INTO service_key_secret_id;
  ELSE
    PERFORM vault.update_secret(
      service_key_secret_id,
      target_service_key,
      'crewflow_edge_function_service_key',
      'Secret API key used only by scheduled CrewFlow Edge Functions.'
    );
  END IF;

  SELECT cron.schedule(
    'crewflow-process-push-notifications',
    '* * * * *',
    $command$
      SELECT net.http_post(
        url := (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'crewflow_project_url'
        ) || '/functions/v1/process-push-notifications',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'crewflow_edge_function_service_key'
          )
        ),
        body := jsonb_build_object('scheduled_at', now()),
        timeout_milliseconds := 10000
      ) AS request_id;
    $command$
  ) INTO scheduled_job_id;

  RETURN scheduled_job_id;
END;
$$;

CREATE FUNCTION public.get_push_notification_cron_status()
RETURNS TABLE (
  job_id bigint,
  schedule text,
  active boolean,
  last_status text,
  last_run_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    job.jobid::bigint,
    job.schedule::text,
    job.active,
    latest_run.status::text,
    latest_run.end_time
  FROM cron.job AS job
  LEFT JOIN LATERAL (
    SELECT run.status, run.end_time
    FROM cron.job_run_details AS run
    WHERE run.jobid = job.jobid
    ORDER BY run.runid DESC
    LIMIT 1
  ) AS latest_run ON true
  WHERE job.jobname = 'crewflow-process-push-notifications';
$$;

REVOKE ALL ON FUNCTION public.configure_push_notification_cron(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_push_notification_cron(text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.get_push_notification_cron_status()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_push_notification_cron_status()
  TO service_role;

COMMENT ON FUNCTION public.configure_push_notification_cron(text, text) IS
  'Service-only idempotent setup for the Vault-backed push delivery cron job.';
COMMENT ON FUNCTION public.get_push_notification_cron_status() IS
  'Service-only operational status for the push delivery cron job.';
