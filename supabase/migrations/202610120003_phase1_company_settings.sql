-- CrewFlow Phase 1: transactional owner-managed company settings and hours.
-- Tenant identity is derived from auth.uid(); callers cannot select a tenant.

CREATE FUNCTION public.update_company_settings(
  input_legal_name text,
  input_display_name text,
  input_business_email text,
  input_phone text,
  input_street_address text,
  input_city text,
  input_state_code text,
  input_postal_code text,
  input_service_categories text[],
  input_time_zone text,
  input_tax_rate_bps integer,
  input_notifications_enabled boolean,
  input_ai_operations_enabled boolean,
  input_ai_monthly_budget_cents integer,
  input_weekly_hours jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  target_tenant_id uuid;
BEGIN
  SELECT membership.tenant_id
  INTO target_tenant_id
  FROM public.memberships AS membership
  WHERE membership.user_id = current_user_id
    AND membership.role = 'owner'
    AND membership.status = 'active';

  IF target_tenant_id IS NULL THEN
    RAISE EXCEPTION 'company settings access denied' USING ERRCODE = '42501';
  END IF;

  IF char_length(trim(input_legal_name)) NOT BETWEEN 2 AND 160
    OR char_length(trim(input_display_name)) NOT BETWEEN 2 AND 120
    OR input_business_email IS NULL
    OR trim(input_business_email) !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR char_length(coalesce(input_phone, '')) > 30
    OR char_length(trim(input_street_address)) NOT BETWEEN 3 AND 180
    OR char_length(trim(input_city)) NOT BETWEEN 2 AND 100
    OR input_state_code !~ '^[A-Z]{2}$'
    OR input_postal_code !~ '^\d{5}(-\d{4})?$'
    OR cardinality(coalesce(input_service_categories, '{}')) NOT BETWEEN 1 AND 6
    OR EXISTS (
      SELECT 1 FROM unnest(coalesce(input_service_categories, '{}')) AS category
      WHERE category <> ALL (
        ARRAY['HVAC', 'Plumbing', 'Electrical', 'Cleaning', 'Pest control', 'Other']
      )
    )
    OR input_time_zone <> ALL (
      ARRAY[
        'America/New_York',
        'America/Chicago',
        'America/Denver',
        'America/Phoenix',
        'America/Los_Angeles',
        'America/Anchorage',
        'Pacific/Honolulu'
      ]
    )
    OR input_tax_rate_bps NOT BETWEEN 0 AND 10000
    OR input_ai_monthly_budget_cents NOT BETWEEN 0 AND 100000000 THEN
    RAISE EXCEPTION 'invalid company settings' USING ERRCODE = '22023';
  END IF;

  IF input_weekly_hours IS NULL
    OR pg_catalog.jsonb_typeof(input_weekly_hours) <> 'array'
    OR pg_catalog.jsonb_array_length(input_weekly_hours) <> 7 THEN
    RAISE EXCEPTION 'invalid business hours' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(input_weekly_hours) AS hours_item
    WHERE (hours_item ->> 'dayOfWeek')::integer NOT BETWEEN 0 AND 6
      OR (hours_item ->> 'isOpen')::boolean IS NULL
      OR (
        (hours_item ->> 'isOpen')::boolean
        AND (
          hours_item ->> 'opensAt' IS NULL
          OR hours_item ->> 'closesAt' IS NULL
          OR (hours_item ->> 'opensAt')::time >= (hours_item ->> 'closesAt')::time
        )
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(input_weekly_hours) AS hours_item
    GROUP BY hours_item ->> 'dayOfWeek'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'invalid business hours' USING ERRCODE = '22023';
  END IF;

  UPDATE public.tenants
  SET
    legal_name = trim(input_legal_name),
    display_name = trim(input_display_name),
    business_email = lower(trim(input_business_email)),
    phone = nullif(trim(input_phone), ''),
    street_address = trim(input_street_address),
    city = trim(input_city),
    state_code = input_state_code,
    postal_code = input_postal_code,
    service_categories = ARRAY(
      SELECT DISTINCT category
      FROM unnest(input_service_categories) AS category
      ORDER BY category
    ),
    time_zone = input_time_zone,
    tax_rate_bps = input_tax_rate_bps
  WHERE id = target_tenant_id;

  UPDATE public.tenant_settings
  SET
    notifications_enabled = input_notifications_enabled,
    ai_operations_enabled = input_ai_operations_enabled,
    ai_monthly_budget_cents = input_ai_monthly_budget_cents
  WHERE tenant_id = target_tenant_id;

  INSERT INTO public.business_hours (
    tenant_id,
    day_of_week,
    is_open,
    opens_at,
    closes_at
  )
  SELECT
    target_tenant_id,
    (hours_item ->> 'dayOfWeek')::smallint,
    (hours_item ->> 'isOpen')::boolean,
    CASE
      WHEN (hours_item ->> 'isOpen')::boolean
      THEN (hours_item ->> 'opensAt')::time
      ELSE NULL
    END,
    CASE
      WHEN (hours_item ->> 'isOpen')::boolean
      THEN (hours_item ->> 'closesAt')::time
      ELSE NULL
    END
  FROM pg_catalog.jsonb_array_elements(input_weekly_hours) AS hours_item
  ON CONFLICT (tenant_id, day_of_week) DO UPDATE SET
    is_open = EXCLUDED.is_open,
    opens_at = EXCLUDED.opens_at,
    closes_at = EXCLUDED.closes_at;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  )
  VALUES (
    target_tenant_id,
    current_user_id,
    'tenant.settings_updated',
    'tenant',
    target_tenant_id,
    pg_catalog.jsonb_build_object(
      'business_hours_updated', true,
      'ai_operations_enabled', input_ai_operations_enabled
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_company_settings(
  text, text, text, text, text, text, text, text, text[], text, integer,
  boolean, boolean, integer, jsonb
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.update_company_settings(
  text, text, text, text, text, text, text, text, text[], text, integer,
  boolean, boolean, integer, jsonb
) TO authenticated;

COMMENT ON FUNCTION public.update_company_settings(
  text, text, text, text, text, text, text, text, text[], text, integer,
  boolean, boolean, integer, jsonb
) IS 'Atomically updates owner-managed company settings and weekly business hours.';
