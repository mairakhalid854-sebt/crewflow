-- CrewFlow Phase 5: owner-only Paddle sandbox checkout catalog.
--
-- Catalog rows are inserted separately after Paddle returns real sandbox price
-- IDs. This RPC exposes only active sandbox plans and never exposes provider
-- credentials or live billing configuration.

CREATE FUNCTION public.list_owner_paddle_sandbox_plans()
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
    AND EXISTS (
      SELECT 1
      FROM public.memberships AS membership
      WHERE membership.user_id = auth.uid()
        AND membership.role = 'owner'
        AND membership.status = 'active'
    )
    AND plan.provider = 'paddle_sandbox'
    AND plan.is_active
    AND plan.is_development_only
    AND plan.provider_price_id IS NOT NULL
    AND plan.amount_cents IS NOT NULL
    AND plan.billing_interval IS NOT NULL
  ORDER BY plan.amount_cents, plan.code;
$$;

REVOKE ALL ON FUNCTION public.list_owner_paddle_sandbox_plans() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_owner_paddle_sandbox_plans()
  TO authenticated;

COMMENT ON FUNCTION public.list_owner_paddle_sandbox_plans() IS
  'Returns active Paddle sandbox plans to authenticated owners for test checkout.';
