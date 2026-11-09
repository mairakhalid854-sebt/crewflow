-- CrewFlow360: live Paddle billing.
--
-- Owner-approved on 2026-11-04:
-- - Live catalog: Starter $29 (3 seats), Growth $79 (10), Pro $149 (30),
--   monthly, USD, 14-day card-required free trial configured on the Paddle
--   price.
-- - Workspaces created from now on must start a subscription before they can
--   change business records. Existing workspaces keep their free
--   development_stub entitlement.
--
-- Sandbox billing keeps working beside live billing because staging and
-- production currently share one Supabase project. Every provider-specific
-- function takes the provider explicitly, and the sandbox entry points remain
-- as thin wrappers so the deployed sandbox Edge Functions keep working.

-- 1. Allow live provider rows.

ALTER TABLE public.billing_plans
DROP CONSTRAINT billing_plans_price_shape;

ALTER TABLE public.billing_plans
ADD CONSTRAINT billing_plans_price_shape CHECK (
  (
    provider = 'stub'
    AND provider_price_id IS NULL
    AND amount_cents IS NULL
    AND billing_interval IS NULL
    AND is_development_only
  )
  OR (
    provider = 'paddle_sandbox'
    AND provider_price_id ~ '^pri_[a-z0-9]{26}$'
    AND amount_cents >= 0
    AND billing_interval IS NOT NULL
    AND is_development_only
  )
  OR (
    provider = 'paddle'
    AND provider_price_id ~ '^pri_[a-z0-9]{26}$'
    AND amount_cents > 0
    AND billing_interval IS NOT NULL
    AND NOT is_development_only
  )
);

ALTER TABLE public.tenant_subscriptions
DROP CONSTRAINT tenant_subscriptions_provider_shape;

ALTER TABLE public.tenant_subscriptions
ADD CONSTRAINT tenant_subscriptions_provider_shape CHECK (
  (
    provider = 'stub'
    AND provider_customer_id IS NULL
    AND provider_subscription_id IS NULL
    AND current_period_starts_at IS NULL
    AND current_period_ends_at IS NULL
  )
  OR (
    provider IN ('paddle_sandbox', 'paddle')
    AND provider_customer_id ~ '^ctm_[a-z0-9]{26}$'
    AND provider_subscription_id ~ '^sub_[a-z0-9]{26}$'
  )
);

-- 2. Catalog: the "choose a plan" placeholder and the live prices.

INSERT INTO public.billing_plans (
  code, provider, display_name, is_active, is_development_only
) VALUES (
  'checkout_required', 'stub', 'Choose a plan', true, true
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.billing_plans (
  code, provider, display_name, billing_interval, provider_price_id,
  amount_cents, currency_code, seat_limit, ai_monthly_budget_cents,
  trial_days, is_active, is_development_only
) VALUES
  ('starter_monthly', 'paddle', 'Starter', 'month', 'pri_01m6k8spcay1tgqctewmv8jhwh', 2900, 'USD', 3, NULL, 14, true, false),
  ('growth_monthly', 'paddle', 'Growth', 'month', 'pri_01m6k8vg3stm76898n4673n648', 7900, 'USD', 10, NULL, 14, true, false),
  ('pro_monthly', 'paddle', 'Pro', 'month', 'pri_01m6k8x4a6ehvnyex8bqtgs2ts', 14900, 'USD', 30, NULL, 14, true, false)
ON CONFLICT (code) DO UPDATE SET
  provider = EXCLUDED.provider,
  display_name = EXCLUDED.display_name,
  billing_interval = EXCLUDED.billing_interval,
  provider_price_id = EXCLUDED.provider_price_id,
  amount_cents = EXCLUDED.amount_cents,
  currency_code = EXCLUDED.currency_code,
  seat_limit = EXCLUDED.seat_limit,
  ai_monthly_budget_cents = EXCLUDED.ai_monthly_budget_cents,
  trial_days = EXCLUDED.trial_days,
  is_active = EXCLUDED.is_active,
  is_development_only = EXCLUDED.is_development_only;

-- 3. New workspaces must choose a plan.
--
-- create_tenant_with_owner inserts the tenant, the owner membership, settings,
-- and business hours in one transaction, and the membership and settings
-- writes need write access. The seed trigger therefore still grants the stub
-- entitlement immediately, and this deferred trigger switches the workspace to
-- checkout_required when that transaction commits.

CREATE FUNCTION public.require_checkout_for_new_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.tenant_subscriptions AS subscription
  SET plan_code = 'checkout_required',
      status = 'paused',
      access_mode = 'read_only'
  WHERE subscription.tenant_id = NEW.id
    AND subscription.provider = 'stub'
    AND subscription.plan_code = 'development_stub';

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER tenants_require_checkout
AFTER INSERT ON public.tenants
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.require_checkout_for_new_tenant();

REVOKE ALL ON FUNCTION public.require_checkout_for_new_tenant() FROM PUBLIC;

COMMENT ON FUNCTION public.require_checkout_for_new_tenant() IS
  'At commit, moves a newly created workspace from the setup stub entitlement to checkout_required (read-only until a Paddle subscription starts).';

CREATE FUNCTION public.get_current_tenant_requires_checkout()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (
      SELECT subscription.plan_code = 'checkout_required'
        OR (
          subscription.provider IN ('paddle_sandbox', 'paddle')
          AND subscription.status = 'canceled'
        )
      FROM public.memberships AS membership
      JOIN public.tenant_subscriptions AS subscription
        ON subscription.tenant_id = membership.tenant_id
      WHERE membership.user_id = auth.uid()
        AND membership.status = 'active'
      LIMIT 1
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.get_current_tenant_requires_checkout()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_tenant_requires_checkout()
  TO authenticated;

COMMENT ON FUNCTION public.get_current_tenant_requires_checkout() IS
  'True when the caller''s workspace has no running subscription and must choose a plan.';

-- 4. Owner checkout catalog for either Paddle environment.

CREATE FUNCTION public.list_owner_paddle_plans(
  target_provider public.billing_provider
)
RETURNS TABLE (
  code text,
  display_name text,
  provider_price_id text,
  amount_cents bigint,
  currency_code text,
  billing_interval public.billing_interval,
  seat_limit integer,
  trial_days integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    plan.code,
    plan.display_name,
    plan.provider_price_id,
    plan.amount_cents,
    plan.currency_code,
    plan.billing_interval,
    plan.seat_limit,
    plan.trial_days
  FROM public.billing_plans AS plan
  WHERE auth.uid() IS NOT NULL
    AND target_provider IN ('paddle_sandbox', 'paddle')
    AND EXISTS (
      SELECT 1
      FROM public.memberships AS membership
      WHERE membership.user_id = auth.uid()
        AND membership.role = 'owner'
        AND membership.status = 'active'
    )
    AND plan.provider = target_provider
    AND plan.is_active
    AND plan.is_development_only = (target_provider = 'paddle_sandbox')
    AND plan.provider_price_id IS NOT NULL
    AND plan.amount_cents IS NOT NULL
    AND plan.billing_interval IS NOT NULL
  ORDER BY plan.amount_cents, plan.code;
$$;

REVOKE ALL ON FUNCTION public.list_owner_paddle_plans(public.billing_provider)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_owner_paddle_plans(public.billing_provider)
  TO authenticated;

COMMENT ON FUNCTION public.list_owner_paddle_plans(public.billing_provider) IS
  'Owner-only active checkout plans for one Paddle environment.';

-- 5. Verified webhook events for either Paddle environment.

CREATE FUNCTION public.apply_paddle_subscription_event(
  target_provider public.billing_provider,
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

  IF target_provider IS NULL
    OR target_provider NOT IN ('paddle_sandbox', 'paddle')
  THEN
    RAISE EXCEPTION 'unsupported Paddle provider' USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'invalid Paddle event shape'
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
    target_provider,
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
    WHERE event.provider = target_provider
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
    WHERE provider = target_provider
      AND external_event_id = target_event_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenants AS tenant WHERE tenant.id = target_tenant_id
  ) THEN
    UPDATE public.billing_webhook_events
    SET status = 'failed', failure_code = 'tenant_not_found'
    WHERE provider = target_provider
      AND external_event_id = target_event_id;
    RETURN 'tenant_not_found';
  END IF;

  SELECT plan.code
  INTO mapped_plan_code
  FROM public.billing_plans AS plan
  WHERE plan.provider = target_provider
    AND plan.provider_price_id = target_provider_price_id
    AND plan.is_active;

  IF mapped_plan_code IS NULL THEN
    UPDATE public.billing_webhook_events
    SET status = 'failed', failure_code = 'plan_not_configured'
    WHERE provider = target_provider
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
    WHERE provider = target_provider
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
    target_provider,
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
  WHERE provider = target_provider
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
      'provider', target_provider,
      'event_type', target_event_type,
      'status', target_status,
      'access_mode', mapped_access
    )
  );

  RETURN 'processed';
END;
$$;

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
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.apply_paddle_subscription_event(
    'paddle_sandbox',
    target_event_id,
    target_event_type,
    target_occurred_at,
    target_payload_sha256,
    target_tenant_id,
    target_provider_customer_id,
    target_provider_subscription_id,
    target_provider_price_id,
    target_status,
    target_period_starts_at,
    target_period_ends_at,
    target_cancel_at_period_end
  );
$$;

REVOKE ALL ON FUNCTION public.apply_paddle_subscription_event(
  public.billing_provider, text, text, timestamptz, text, uuid, text, text,
  text, public.subscription_status, timestamptz, timestamptz, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_paddle_subscription_event(
  public.billing_provider, text, text, timestamptz, text, uuid, text, text,
  text, public.subscription_status, timestamptz, timestamptz, boolean
) TO service_role;

COMMENT ON FUNCTION public.apply_paddle_subscription_event(
  public.billing_provider, text, text, timestamptz, text, uuid, text, text,
  text, public.subscription_status, timestamptz, timestamptz, boolean
) IS 'Applies verified Paddle sandbox or live subscription events idempotently.';

-- 6. Reconciliation for either Paddle environment.

CREATE FUNCTION public.list_paddle_subscriptions_for_reconciliation(
  target_provider public.billing_provider,
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

  IF target_provider IS NULL
    OR target_provider NOT IN ('paddle_sandbox', 'paddle')
  THEN
    RAISE EXCEPTION 'unsupported Paddle provider' USING ERRCODE = '22023';
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
  WHERE subscription.provider = target_provider
  ORDER BY subscription.updated_at, subscription.tenant_id
  LIMIT batch_size;
END;
$$;

CREATE FUNCTION public.begin_paddle_reconciliation(
  target_provider public.billing_provider
)
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

  IF target_provider IS NULL
    OR target_provider NOT IN ('paddle_sandbox', 'paddle')
  THEN
    RAISE EXCEPTION 'unsupported Paddle provider' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.billing_reconciliation_runs (provider)
  VALUES (target_provider)
  RETURNING id INTO run_id;

  RETURN run_id;
END;
$$;

CREATE FUNCTION public.finish_paddle_reconciliation(
  target_provider public.billing_provider,
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

  IF target_provider IS NULL
    OR target_provider NOT IN ('paddle_sandbox', 'paddle')
    OR target_status NOT IN ('succeeded', 'partial', 'failed')
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
    AND run.provider = target_provider
    AND run.status = 'running';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'running reconciliation not found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

CREATE FUNCTION public.apply_paddle_reconciliation_snapshot(
  target_provider public.billing_provider,
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

  IF target_provider IS NULL
    OR target_provider NOT IN ('paddle_sandbox', 'paddle')
    OR target_provider_customer_id !~ '^ctm_[a-z0-9]{26}$'
    OR target_provider_subscription_id !~ '^sub_[a-z0-9]{26}$'
    OR target_provider_price_id !~ '^pri_[a-z0-9]{26}$'
    OR target_provider_updated_at IS NULL
    OR (
      target_period_starts_at IS NOT NULL
      AND target_period_ends_at IS NOT NULL
      AND target_period_ends_at <= target_period_starts_at
    )
  THEN
    RAISE EXCEPTION 'invalid Paddle snapshot shape'
      USING ERRCODE = '22023';
  END IF;

  SELECT subscription.*
  INTO current_subscription
  FROM public.tenant_subscriptions AS subscription
  WHERE subscription.tenant_id = target_tenant_id
  FOR UPDATE;

  IF NOT FOUND OR current_subscription.provider <> target_provider THEN
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
  WHERE plan.provider = target_provider
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
      'provider', target_provider,
      'status', target_status,
      'access_mode', mapped_access
    )
  );

  RETURN 'updated';
END;
$$;

CREATE OR REPLACE FUNCTION public.list_paddle_sandbox_subscriptions_for_reconciliation(
  batch_size integer DEFAULT 50
)
RETURNS TABLE (
  tenant_id uuid,
  provider_customer_id text,
  provider_subscription_id text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT *
  FROM public.list_paddle_subscriptions_for_reconciliation(
    'paddle_sandbox',
    batch_size
  );
$$;

CREATE OR REPLACE FUNCTION public.begin_paddle_sandbox_reconciliation()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.begin_paddle_reconciliation('paddle_sandbox');
$$;

CREATE OR REPLACE FUNCTION public.finish_paddle_sandbox_reconciliation(
  target_run_id uuid,
  target_status public.billing_reconciliation_status,
  target_checked_count integer,
  target_updated_count integer,
  target_failure_count integer,
  target_error_code text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.finish_paddle_reconciliation(
    'paddle_sandbox',
    target_run_id,
    target_status,
    target_checked_count,
    target_updated_count,
    target_failure_count,
    target_error_code
  );
$$;

CREATE OR REPLACE FUNCTION public.apply_paddle_sandbox_reconciliation_snapshot(
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
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.apply_paddle_reconciliation_snapshot(
    'paddle_sandbox',
    target_tenant_id,
    target_provider_customer_id,
    target_provider_subscription_id,
    target_provider_price_id,
    target_status,
    target_period_starts_at,
    target_period_ends_at,
    target_cancel_at_period_end,
    target_provider_updated_at
  );
$$;

REVOKE ALL ON FUNCTION public.list_paddle_subscriptions_for_reconciliation(
  public.billing_provider, integer
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_paddle_reconciliation(public.billing_provider)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_paddle_reconciliation(
  public.billing_provider, uuid, public.billing_reconciliation_status,
  integer, integer, integer, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_paddle_reconciliation_snapshot(
  public.billing_provider, uuid, text, text, text, public.subscription_status,
  timestamptz, timestamptz, boolean, timestamptz
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_paddle_subscriptions_for_reconciliation(
  public.billing_provider, integer
) TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_paddle_reconciliation(public.billing_provider)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_paddle_reconciliation(
  public.billing_provider, uuid, public.billing_reconciliation_status,
  integer, integer, integer, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_paddle_reconciliation_snapshot(
  public.billing_provider, uuid, text, text, text, public.subscription_status,
  timestamptz, timestamptz, boolean, timestamptz
) TO service_role;

-- 7. Hourly live reconciliation cron, enabled explicitly after the live API
-- key is stored in Edge Function secrets.

CREATE FUNCTION public.configure_paddle_live_reconciliation_cron()
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
    'crewflow-reconcile-paddle-live-billing',
    '47 * * * *',
    $command$
      SELECT net.http_post(
        url := (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'crewflow_project_url'
        ) || '/functions/v1/reconcile-paddle-live-billing',
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

REVOKE ALL ON FUNCTION public.configure_paddle_live_reconciliation_cron()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_paddle_live_reconciliation_cron()
  TO service_role;

COMMENT ON FUNCTION public.configure_paddle_live_reconciliation_cron() IS
  'Enables hourly live Paddle reconciliation after PADDLE_LIVE_API_KEY is configured.';
