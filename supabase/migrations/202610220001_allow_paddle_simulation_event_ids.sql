ALTER TABLE public.billing_webhook_events
DROP CONSTRAINT billing_webhook_events_id_format;

ALTER TABLE public.billing_webhook_events
ADD CONSTRAINT billing_webhook_events_id_format CHECK (
  external_event_id ~ '^(evt|ntfsimevt)_[a-z0-9]{26}$'
);

CREATE OR REPLACE FUNCTION public.apply_paddle_sandbox_subscription_event(
  target_event_id text,
  target_event_type text,
  target_occurred_at timestamptz,
  target_payload_sha256 text,
  target_tenant_id uuid,
  target_provider_customer_id text,
  target_provider_subscription_id text,
  target_provider_price_id text,
  target_status public.subscription_status,
  target_period_starts_at timestamptz,
  target_period_ends_at timestamptz,
  target_cancel_at_period_end boolean
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  affected_rows integer;
  existing_event_hash text;
  existing_event_status public.billing_event_status;
  mapped_access public.billing_access_mode;
  mapped_plan_code text;
  latest_event_at timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF target_event_id !~ '^(evt|ntfsimevt)_[a-z0-9]{26}$'
    OR target_event_type NOT IN (
      'subscription.created',
      'subscription.updated',
      'subscription.activated',
      'subscription.trialing',
      'subscription.past_due',
      'subscription.paused',
      'subscription.resumed',
      'subscription.canceled'
    )
    OR target_payload_sha256 !~ '^[a-f0-9]{64}$'
    OR target_provider_customer_id !~ '^ctm_[a-z0-9]{26}$'
    OR target_provider_subscription_id !~ '^sub_[a-z0-9]{26}$'
    OR target_provider_price_id !~ '^pri_[a-z0-9]{26}$'
  THEN
    RAISE EXCEPTION 'invalid Paddle sandbox event shape'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.billing_webhook_events (
    provider,
    external_event_id,
    event_type,
    occurred_at,
    payload_sha256,
    tenant_id,
    status
  ) VALUES (
    'paddle_sandbox',
    target_event_id,
    target_event_type,
    target_occurred_at,
    target_payload_sha256,
    target_tenant_id,
    'ignored'
  )
  ON CONFLICT (provider, external_event_id) DO NOTHING;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows = 0 THEN
    SELECT event.status, event.payload_sha256
    INTO existing_event_status, existing_event_hash
    FROM public.billing_webhook_events AS event
    WHERE event.provider = 'paddle_sandbox'
      AND event.external_event_id = target_event_id
    FOR UPDATE;

    IF existing_event_hash IS DISTINCT FROM target_payload_sha256 THEN
      RETURN 'payload_conflict';
    END IF;

    IF existing_event_status <> 'failed' THEN
      RETURN 'duplicate';
    END IF;

    UPDATE public.billing_webhook_events
    SET status = 'ignored',
        failure_code = NULL,
        processed_at = now()
    WHERE provider = 'paddle_sandbox'
      AND external_event_id = target_event_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenants AS tenant WHERE tenant.id = target_tenant_id
  ) THEN
    UPDATE public.billing_webhook_events
    SET status = 'failed', failure_code = 'tenant_not_found'
    WHERE provider = 'paddle_sandbox'
      AND external_event_id = target_event_id;
    RETURN 'tenant_not_found';
  END IF;

  SELECT plan.code
  INTO mapped_plan_code
  FROM public.billing_plans AS plan
  WHERE plan.provider = 'paddle_sandbox'
    AND plan.provider_price_id = target_provider_price_id
    AND plan.is_active;

  IF mapped_plan_code IS NULL THEN
    UPDATE public.billing_webhook_events
    SET status = 'failed', failure_code = 'plan_not_configured'
    WHERE provider = 'paddle_sandbox'
      AND external_event_id = target_event_id;
    RETURN 'plan_not_configured';
  END IF;

  SELECT subscription.last_provider_event_at
  INTO latest_event_at
  FROM public.tenant_subscriptions AS subscription
  WHERE subscription.tenant_id = target_tenant_id
  FOR UPDATE;

  IF latest_event_at IS NOT NULL AND target_occurred_at < latest_event_at THEN
    UPDATE public.billing_webhook_events
    SET status = 'ignored'
    WHERE provider = 'paddle_sandbox'
      AND external_event_id = target_event_id;
    RETURN 'out_of_order';
  END IF;

  mapped_access := CASE target_status
    WHEN 'active' THEN 'full'
    WHEN 'trialing' THEN 'full'
    WHEN 'past_due' THEN 'grace'
    WHEN 'paused' THEN 'read_only'
    WHEN 'canceled' THEN 'read_only'
  END;

  INSERT INTO public.tenant_subscriptions (
    tenant_id,
    plan_code,
    provider,
    status,
    access_mode,
    provider_customer_id,
    provider_subscription_id,
    current_period_starts_at,
    current_period_ends_at,
    cancel_at_period_end,
    last_provider_event_at
  ) VALUES (
    target_tenant_id,
    mapped_plan_code,
    'paddle_sandbox',
    target_status,
    mapped_access,
    target_provider_customer_id,
    target_provider_subscription_id,
    target_period_starts_at,
    target_period_ends_at,
    target_cancel_at_period_end,
    target_occurred_at
  )
  ON CONFLICT (tenant_id) DO UPDATE
  SET plan_code = EXCLUDED.plan_code,
      provider = EXCLUDED.provider,
      status = EXCLUDED.status,
      access_mode = EXCLUDED.access_mode,
      provider_customer_id = EXCLUDED.provider_customer_id,
      provider_subscription_id = EXCLUDED.provider_subscription_id,
      current_period_starts_at = EXCLUDED.current_period_starts_at,
      current_period_ends_at = EXCLUDED.current_period_ends_at,
      cancel_at_period_end = EXCLUDED.cancel_at_period_end,
      last_provider_event_at = EXCLUDED.last_provider_event_at;

  UPDATE public.billing_webhook_events
  SET status = 'processed'
  WHERE provider = 'paddle_sandbox'
    AND external_event_id = target_event_id;

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
    'billing.entitlement_synced',
    'tenant',
    target_tenant_id,
    jsonb_build_object(
      'provider', 'paddle_sandbox',
      'event_type', target_event_type,
      'status', target_status,
      'access_mode', mapped_access
    )
  );

  RETURN 'processed';
END;
$$;

COMMENT ON FUNCTION public.apply_paddle_sandbox_subscription_event(
  text, text, timestamptz, text, uuid, text, text, text,
  public.subscription_status, timestamptz, timestamptz, boolean
) IS 'Applies verified Paddle sandbox platform and simulator subscription events idempotently.';
