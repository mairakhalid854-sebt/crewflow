-- CrewFlow Phase 5: dormant Paddle sandbox portal and reconciliation support.
--
-- This migration still does not enable live billing. Reconciliation can only
-- inspect subscriptions already linked to the Paddle sandbox provider, and
-- its cron job must be configured explicitly after a sandbox API key exists.

CREATE TYPE public.billing_reconciliation_status AS ENUM (
  'running',
  'succeeded',
  'partial',
  'failed'
);

CREATE TABLE public.billing_reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider public.billing_provider NOT NULL,
  status public.billing_reconciliation_status NOT NULL DEFAULT 'running',
  checked_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT billing_reconciliation_runs_counts CHECK (
    checked_count >= 0
    AND updated_count >= 0
    AND failure_count >= 0
    AND updated_count + failure_count <= checked_count
  ),
  CONSTRAINT billing_reconciliation_runs_completion CHECK (
    (status = 'running' AND finished_at IS NULL AND error_code IS NULL)
    OR (status <> 'running' AND finished_at IS NOT NULL)
  ),
  CONSTRAINT billing_reconciliation_runs_error_length CHECK (
    error_code IS NULL OR char_length(error_code) BETWEEN 1 AND 80
  )
);

CREATE INDEX billing_reconciliation_runs_started_idx
  ON public.billing_reconciliation_runs (provider, started_at DESC);

ALTER TABLE public.billing_reconciliation_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_reconciliation_runs FROM anon, authenticated;

CREATE FUNCTION public.get_owner_billing_portal_context(target_user_id uuid)
RETURNS TABLE (
  provider public.billing_provider,
  provider_customer_id text,
  provider_subscription_id text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    subscription.provider,
    subscription.provider_customer_id,
    subscription.provider_subscription_id
  FROM public.memberships AS membership
  JOIN public.tenant_subscriptions AS subscription
    ON subscription.tenant_id = membership.tenant_id
  WHERE membership.user_id = target_user_id
    AND membership.status = 'active'
    AND membership.role = 'owner';
END;
$$;

CREATE FUNCTION public.list_paddle_sandbox_subscriptions_for_reconciliation(
  batch_size integer DEFAULT 50
)
RETURNS TABLE (
  tenant_id uuid,
  provider_customer_id text,
  provider_subscription_id text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF batch_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'batch size must be between 1 and 100'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    subscription.tenant_id,
    subscription.provider_customer_id,
    subscription.provider_subscription_id
  FROM public.tenant_subscriptions AS subscription
  WHERE subscription.provider = 'paddle_sandbox'
  ORDER BY subscription.updated_at, subscription.tenant_id
  LIMIT batch_size;
END;
$$;

CREATE FUNCTION public.begin_paddle_sandbox_reconciliation()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  run_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.billing_reconciliation_runs (provider)
  VALUES ('paddle_sandbox')
  RETURNING id INTO run_id;

  RETURN run_id;
END;
$$;

CREATE FUNCTION public.finish_paddle_sandbox_reconciliation(
  target_run_id uuid,
  target_status public.billing_reconciliation_status,
  target_checked_count integer,
  target_updated_count integer,
  target_failure_count integer,
  target_error_code text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF target_status NOT IN ('succeeded', 'partial', 'failed')
    OR target_checked_count < 0
    OR target_updated_count < 0
    OR target_failure_count < 0
    OR target_updated_count + target_failure_count > target_checked_count
    OR (target_error_code IS NOT NULL AND char_length(target_error_code) > 80)
  THEN
    RAISE EXCEPTION 'invalid reconciliation result' USING ERRCODE = '22023';
  END IF;

  UPDATE public.billing_reconciliation_runs AS run
  SET status = target_status,
      checked_count = target_checked_count,
      updated_count = target_updated_count,
      failure_count = target_failure_count,
      error_code = target_error_code,
      finished_at = now()
  WHERE run.id = target_run_id
    AND run.provider = 'paddle_sandbox'
    AND run.status = 'running';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'running reconciliation not found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

CREATE FUNCTION public.apply_paddle_sandbox_reconciliation_snapshot(
  target_tenant_id uuid,
  target_provider_customer_id text,
  target_provider_subscription_id text,
  target_provider_price_id text,
  target_status public.subscription_status,
  target_period_starts_at timestamptz,
  target_period_ends_at timestamptz,
  target_cancel_at_period_end boolean,
  target_provider_updated_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_subscription public.tenant_subscriptions%ROWTYPE;
  mapped_access public.billing_access_mode;
  mapped_plan_code text;
  has_changes boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF target_provider_customer_id !~ '^ctm_[a-z0-9]{26}$'
    OR target_provider_subscription_id !~ '^sub_[a-z0-9]{26}$'
    OR target_provider_price_id !~ '^pri_[a-z0-9]{26}$'
    OR target_provider_updated_at IS NULL
    OR (
      target_period_starts_at IS NOT NULL
      AND target_period_ends_at IS NOT NULL
      AND target_period_ends_at <= target_period_starts_at
    )
  THEN
    RAISE EXCEPTION 'invalid Paddle sandbox snapshot shape'
      USING ERRCODE = '22023';
  END IF;

  SELECT subscription.*
  INTO current_subscription
  FROM public.tenant_subscriptions AS subscription
  WHERE subscription.tenant_id = target_tenant_id
  FOR UPDATE;

  IF NOT FOUND OR current_subscription.provider <> 'paddle_sandbox' THEN
    RETURN 'subscription_not_found';
  END IF;

  IF current_subscription.provider_customer_id
       IS DISTINCT FROM target_provider_customer_id
    OR current_subscription.provider_subscription_id
       IS DISTINCT FROM target_provider_subscription_id
  THEN
    RETURN 'identity_mismatch';
  END IF;

  IF current_subscription.last_provider_event_at IS NOT NULL
    AND target_provider_updated_at < current_subscription.last_provider_event_at
  THEN
    RETURN 'out_of_order';
  END IF;

  SELECT plan.code
  INTO mapped_plan_code
  FROM public.billing_plans AS plan
  WHERE plan.provider = 'paddle_sandbox'
    AND plan.provider_price_id = target_provider_price_id
    AND plan.is_active;

  IF mapped_plan_code IS NULL THEN
    RETURN 'plan_not_configured';
  END IF;

  mapped_access := CASE target_status
    WHEN 'active' THEN 'full'
    WHEN 'trialing' THEN 'full'
    WHEN 'past_due' THEN 'grace'
    WHEN 'paused' THEN 'read_only'
    WHEN 'canceled' THEN 'read_only'
  END;

  has_changes := current_subscription.plan_code IS DISTINCT FROM mapped_plan_code
    OR current_subscription.status IS DISTINCT FROM target_status
    OR current_subscription.access_mode IS DISTINCT FROM mapped_access
    OR current_subscription.current_period_starts_at
       IS DISTINCT FROM target_period_starts_at
    OR current_subscription.current_period_ends_at
       IS DISTINCT FROM target_period_ends_at
    OR current_subscription.cancel_at_period_end
       IS DISTINCT FROM target_cancel_at_period_end;

  UPDATE public.tenant_subscriptions AS subscription
  SET plan_code = mapped_plan_code,
      status = target_status,
      access_mode = mapped_access,
      current_period_starts_at = target_period_starts_at,
      current_period_ends_at = target_period_ends_at,
      cancel_at_period_end = target_cancel_at_period_end,
      last_provider_event_at = GREATEST(
        subscription.last_provider_event_at,
        target_provider_updated_at
      )
  WHERE subscription.tenant_id = target_tenant_id;

  IF NOT has_changes THEN
    RETURN 'unchanged';
  END IF;

  INSERT INTO public.audit_events (
    tenant_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) VALUES (
    target_tenant_id,
    NULL,
    'billing.entitlement_reconciled',
    'tenant',
    target_tenant_id,
    jsonb_build_object(
      'provider', 'paddle_sandbox',
      'status', target_status,
      'access_mode', mapped_access
    )
  );

  RETURN 'updated';
END;
$$;

CREATE FUNCTION public.configure_paddle_reconciliation_cron()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  scheduled_job_id bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vault.secrets WHERE name = 'crewflow_project_url'
  ) OR NOT EXISTS (
    SELECT 1
    FROM vault.secrets
    WHERE name = 'crewflow_edge_function_service_key'
  ) THEN
    RAISE EXCEPTION 'shared CrewFlow cron secrets are not configured'
      USING ERRCODE = '55000';
  END IF;

  SELECT cron.schedule(
    'crewflow-reconcile-paddle-billing',
    '17 * * * *',
    $command$
      SELECT net.http_post(
        url := (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'crewflow_project_url'
        ) || '/functions/v1/reconcile-paddle-billing',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'crewflow_edge_function_service_key'
          )
        ),
        body := jsonb_build_object('scheduled_at', now()),
        timeout_milliseconds := 30000
      ) AS request_id;
    $command$
  ) INTO scheduled_job_id;

  RETURN scheduled_job_id;
END;
$$;

CREATE FUNCTION public.get_paddle_reconciliation_cron_status()
RETURNS TABLE (
  job_id bigint,
  schedule text,
  active boolean,
  last_status text,
  last_run_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
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
  WHERE job.jobname = 'crewflow-reconcile-paddle-billing';
END;
$$;

REVOKE ALL ON FUNCTION public.get_owner_billing_portal_context(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_paddle_sandbox_subscriptions_for_reconciliation(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_paddle_sandbox_reconciliation()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_paddle_sandbox_reconciliation(
  uuid, public.billing_reconciliation_status, integer, integer, integer, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_paddle_sandbox_reconciliation_snapshot(
  uuid, text, text, text, public.subscription_status,
  timestamptz, timestamptz, boolean, timestamptz
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.configure_paddle_reconciliation_cron()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_paddle_reconciliation_cron_status()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_owner_billing_portal_context(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.list_paddle_sandbox_subscriptions_for_reconciliation(integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_paddle_sandbox_reconciliation()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_paddle_sandbox_reconciliation(
  uuid, public.billing_reconciliation_status, integer, integer, integer, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_paddle_sandbox_reconciliation_snapshot(
  uuid, text, text, text, public.subscription_status,
  timestamptz, timestamptz, boolean, timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.configure_paddle_reconciliation_cron()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_paddle_reconciliation_cron_status()
  TO service_role;

COMMENT ON FUNCTION public.configure_paddle_reconciliation_cron() IS
  'Enables hourly Paddle sandbox reconciliation after its Edge Function API key is configured.';
