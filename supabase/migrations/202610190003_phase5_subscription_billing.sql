-- CrewFlow Phase 5: configuration-driven SaaS subscription entitlements.
--
-- This migration deliberately supports only the local stub and Paddle sandbox.
-- Live billing must be enabled by a later, explicitly approved migration after
-- seller eligibility, plans, pricing, grace policy, and legal terms are final.

CREATE TYPE public.billing_provider AS ENUM ('stub', 'paddle_sandbox');
CREATE TYPE public.billing_interval AS ENUM ('month', 'year');
CREATE TYPE public.subscription_status AS ENUM (
  'trialing',
  'active',
  'past_due',
  'paused',
  'canceled'
);
CREATE TYPE public.billing_access_mode AS ENUM ('full', 'grace', 'read_only');
CREATE TYPE public.billing_event_status AS ENUM (
  'processed',
  'ignored',
  'failed'
);

CREATE TABLE public.billing_plans (
  code text PRIMARY KEY,
  provider public.billing_provider NOT NULL,
  display_name text NOT NULL,
  billing_interval public.billing_interval,
  provider_price_id text,
  amount_cents bigint,
  currency_code text NOT NULL DEFAULT 'USD',
  seat_limit integer,
  ai_monthly_budget_cents bigint,
  trial_days integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT false,
  is_development_only boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_plans_code_format CHECK (
    code ~ '^[a-z][a-z0-9_-]{2,63}$'
  ),
  CONSTRAINT billing_plans_name_length CHECK (
    char_length(display_name) BETWEEN 2 AND 100
  ),
  CONSTRAINT billing_plans_price_shape CHECK (
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
    )
  ),
  CONSTRAINT billing_plans_currency CHECK (currency_code = 'USD'),
  CONSTRAINT billing_plans_seat_limit CHECK (
    seat_limit IS NULL OR seat_limit BETWEEN 1 AND 10000
  ),
  CONSTRAINT billing_plans_ai_budget CHECK (
    ai_monthly_budget_cents IS NULL
    OR ai_monthly_budget_cents BETWEEN 0 AND 100000000
  ),
  CONSTRAINT billing_plans_trial_days CHECK (trial_days BETWEEN 0 AND 365)
);

CREATE UNIQUE INDEX billing_plans_provider_price_unique
  ON public.billing_plans (provider, provider_price_id)
  WHERE provider_price_id IS NOT NULL;

CREATE TABLE public.tenant_subscriptions (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE RESTRICT,
  plan_code text NOT NULL REFERENCES public.billing_plans(code) ON DELETE RESTRICT,
  provider public.billing_provider NOT NULL,
  status public.subscription_status NOT NULL,
  access_mode public.billing_access_mode NOT NULL,
  provider_customer_id text,
  provider_subscription_id text,
  current_period_starts_at timestamptz,
  current_period_ends_at timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  last_provider_event_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_subscriptions_provider_shape CHECK (
    (
      provider = 'stub'
      AND provider_customer_id IS NULL
      AND provider_subscription_id IS NULL
      AND current_period_starts_at IS NULL
      AND current_period_ends_at IS NULL
    )
    OR (
      provider = 'paddle_sandbox'
      AND provider_customer_id ~ '^ctm_[a-z0-9]{26}$'
      AND provider_subscription_id ~ '^sub_[a-z0-9]{26}$'
    )
  ),
  CONSTRAINT tenant_subscriptions_period_order CHECK (
    current_period_starts_at IS NULL
    OR current_period_ends_at IS NULL
    OR current_period_ends_at > current_period_starts_at
  ),
  CONSTRAINT tenant_subscriptions_access_consistency CHECK (
    (status IN ('active', 'trialing') AND access_mode = 'full')
    OR (status = 'past_due' AND access_mode = 'grace')
    OR (status IN ('paused', 'canceled') AND access_mode = 'read_only')
  )
);

CREATE UNIQUE INDEX tenant_subscriptions_provider_subscription_unique
  ON public.tenant_subscriptions (provider, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

CREATE TABLE public.billing_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider public.billing_provider NOT NULL,
  external_event_id text NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload_sha256 text NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE RESTRICT,
  status public.billing_event_status NOT NULL,
  failure_code text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_webhook_events_external_unique
    UNIQUE (provider, external_event_id),
  CONSTRAINT billing_webhook_events_id_format CHECK (
    external_event_id ~ '^evt_[a-z0-9]{26}$'
  ),
  CONSTRAINT billing_webhook_events_type_length CHECK (
    char_length(event_type) BETWEEN 3 AND 100
  ),
  CONSTRAINT billing_webhook_events_hash_format CHECK (
    payload_sha256 ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT billing_webhook_events_failure_shape CHECK (
    (status = 'failed' AND failure_code IS NOT NULL)
    OR (status <> 'failed' AND failure_code IS NULL)
  ),
  CONSTRAINT billing_webhook_events_failure_length CHECK (
    failure_code IS NULL OR char_length(failure_code) <= 80
  )
);

CREATE INDEX billing_webhook_events_tenant_occurred_idx
  ON public.billing_webhook_events (tenant_id, occurred_at DESC)
  WHERE tenant_id IS NOT NULL;

CREATE TRIGGER billing_plans_updated_at
BEFORE UPDATE ON public.billing_plans
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER tenant_subscriptions_updated_at
BEFORE UPDATE ON public.tenant_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.billing_plans FROM anon, authenticated;
REVOKE ALL ON public.tenant_subscriptions FROM anon, authenticated;
REVOKE ALL ON public.billing_webhook_events FROM anon, authenticated;

-- Keep the stub seed explicit and price-free. It exists only so local/staging
-- business workflows do not depend on a real-money provider.
INSERT INTO public.billing_plans (
  code,
  provider,
  display_name,
  is_active,
  is_development_only
) VALUES (
  'development_stub',
  'stub',
  'Development access',
  true,
  true
);

INSERT INTO public.tenant_subscriptions (
  tenant_id,
  plan_code,
  provider,
  status,
  access_mode
)
SELECT tenant.id, 'development_stub', 'stub', 'active', 'full'
FROM public.tenants AS tenant
ON CONFLICT (tenant_id) DO NOTHING;

CREATE FUNCTION public.seed_stub_subscription_for_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.tenant_subscriptions (
    tenant_id,
    plan_code,
    provider,
    status,
    access_mode
  ) VALUES (
    NEW.id,
    'development_stub',
    'stub',
    'active',
    'full'
  )
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenants_seed_stub_subscription
AFTER INSERT ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.seed_stub_subscription_for_tenant();

CREATE FUNCTION public.get_current_tenant_access_mode()
RETURNS public.billing_access_mode
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_access public.billing_access_mode;
BEGIN
  SELECT subscription.access_mode
  INTO current_access
  FROM public.memberships AS membership
  JOIN public.tenant_subscriptions AS subscription
    ON subscription.tenant_id = membership.tenant_id
  WHERE membership.user_id = auth.uid()
    AND membership.status = 'active';

  IF current_access IS NULL THEN
    RAISE EXCEPTION 'active membership and subscription required'
      USING ERRCODE = '42501';
  END IF;

  RETURN current_access;
END;
$$;

CREATE FUNCTION public.get_owner_billing_summary()
RETURNS TABLE (
  plan_code text,
  plan_name text,
  provider public.billing_provider,
  subscription_status public.subscription_status,
  access_mode public.billing_access_mode,
  billing_interval public.billing_interval,
  amount_cents bigint,
  currency_code text,
  seat_limit integer,
  ai_monthly_budget_cents bigint,
  trial_days integer,
  current_period_starts_at timestamptz,
  current_period_ends_at timestamptz,
  cancel_at_period_end boolean,
  is_development_only boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.memberships AS membership
    WHERE membership.user_id = auth.uid()
      AND membership.status = 'active'
      AND membership.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'owner membership required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    plan.code,
    plan.display_name,
    subscription.provider,
    subscription.status,
    subscription.access_mode,
    plan.billing_interval,
    plan.amount_cents,
    plan.currency_code,
    plan.seat_limit,
    plan.ai_monthly_budget_cents,
    plan.trial_days,
    subscription.current_period_starts_at,
    subscription.current_period_ends_at,
    subscription.cancel_at_period_end,
    plan.is_development_only
  FROM public.memberships AS membership
  JOIN public.tenant_subscriptions AS subscription
    ON subscription.tenant_id = membership.tenant_id
  JOIN public.billing_plans AS plan
    ON plan.code = subscription.plan_code
  WHERE membership.user_id = auth.uid()
    AND membership.status = 'active'
    AND membership.role = 'owner';
END;
$$;

CREATE FUNCTION public.apply_paddle_sandbox_subscription_event(
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

  IF target_event_id !~ '^evt_[a-z0-9]{26}$'
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

CREATE FUNCTION public.set_stub_subscription_state(
  target_tenant_id uuid,
  target_status public.subscription_status
)
RETURNS public.billing_access_mode
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  mapped_access public.billing_access_mode;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  mapped_access := CASE target_status
    WHEN 'active' THEN 'full'
    WHEN 'trialing' THEN 'full'
    WHEN 'past_due' THEN 'grace'
    WHEN 'paused' THEN 'read_only'
    WHEN 'canceled' THEN 'read_only'
  END;

  UPDATE public.tenant_subscriptions AS subscription
  SET status = target_status,
      access_mode = mapped_access
  WHERE subscription.tenant_id = target_tenant_id
    AND subscription.provider = 'stub';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stub subscription not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN mapped_access;
END;
$$;

CREATE FUNCTION public.enforce_tenant_write_entitlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_tenant_id uuid;
  current_access public.billing_access_mode;
BEGIN
  IF auth.role() IS NULL OR auth.role() NOT IN ('anon', 'authenticated') THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'tenants' THEN
    target_tenant_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    target_tenant_id := CASE
      WHEN TG_OP = 'DELETE' THEN OLD.tenant_id
      ELSE NEW.tenant_id
    END;
  END IF;

  SELECT subscription.access_mode
  INTO current_access
  FROM public.tenant_subscriptions AS subscription
  WHERE subscription.tenant_id = target_tenant_id;

  IF current_access = 'read_only' OR current_access IS NULL THEN
    RAISE EXCEPTION 'subscription is read-only'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenants_require_write_entitlement
BEFORE UPDATE OR DELETE ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_write_entitlement();
CREATE TRIGGER memberships_require_write_entitlement
BEFORE INSERT OR UPDATE OR DELETE ON public.memberships
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_write_entitlement();
CREATE TRIGGER tenant_settings_require_write_entitlement
BEFORE INSERT OR UPDATE OR DELETE ON public.tenant_settings
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_write_entitlement();
CREATE TRIGGER business_hours_require_write_entitlement
BEFORE INSERT OR UPDATE OR DELETE ON public.business_hours
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_write_entitlement();
CREATE TRIGGER team_invitations_require_write_entitlement
BEFORE INSERT OR UPDATE OR DELETE ON public.team_invitations
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_write_entitlement();
CREATE TRIGGER staff_profiles_require_write_entitlement
BEFORE INSERT OR UPDATE OR DELETE ON public.staff_profiles
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_write_entitlement();
CREATE TRIGGER staff_availability_require_write_entitlement
BEFORE INSERT OR UPDATE OR DELETE ON public.staff_availability
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_write_entitlement();
CREATE TRIGGER customers_require_write_entitlement
BEFORE INSERT OR UPDATE OR DELETE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_write_entitlement();
CREATE TRIGGER services_require_write_entitlement
BEFORE INSERT OR UPDATE OR DELETE ON public.services
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_write_entitlement();
CREATE TRIGGER jobs_require_write_entitlement
BEFORE INSERT OR UPDATE OR DELETE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_write_entitlement();
CREATE TRIGGER staff_time_off_require_write_entitlement
BEFORE INSERT OR UPDATE OR DELETE ON public.staff_time_off
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_write_entitlement();
CREATE TRIGGER quotes_require_write_entitlement
BEFORE INSERT OR UPDATE OR DELETE ON public.quotes
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_write_entitlement();
CREATE TRIGGER invoices_require_write_entitlement
BEFORE INSERT OR UPDATE OR DELETE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_write_entitlement();
CREATE TRIGGER payment_records_require_write_entitlement
BEFORE INSERT OR UPDATE OR DELETE ON public.payment_records
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_write_entitlement();
CREATE TRIGGER work_reports_require_write_entitlement
BEFORE INSERT OR UPDATE OR DELETE ON public.work_reports
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_write_entitlement();
CREATE TRIGGER job_work_notes_require_write_entitlement
BEFORE INSERT OR UPDATE OR DELETE ON public.job_work_notes
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_write_entitlement();
CREATE TRIGGER job_media_require_write_entitlement
BEFORE INSERT OR UPDATE OR DELETE ON public.job_media
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_write_entitlement();
CREATE TRIGGER job_signatures_require_write_entitlement
BEFORE INSERT OR UPDATE OR DELETE ON public.job_signatures
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_write_entitlement();

REVOKE ALL ON FUNCTION public.seed_stub_subscription_for_tenant() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_current_tenant_access_mode() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_owner_billing_summary() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_paddle_sandbox_subscription_event(
  text, text, timestamptz, text, uuid, text, text, text,
  public.subscription_status, timestamptz, timestamptz, boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_stub_subscription_state(
  uuid, public.subscription_status
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_tenant_write_entitlement() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_current_tenant_access_mode()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_owner_billing_summary()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_paddle_sandbox_subscription_event(
  text, text, timestamptz, text, uuid, text, text, text,
  public.subscription_status, timestamptz, timestamptz, boolean
) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_stub_subscription_state(
  uuid, public.subscription_status
) TO service_role;
