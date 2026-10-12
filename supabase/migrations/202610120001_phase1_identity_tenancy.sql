-- CrewFlow Phase 1: identity, single-tenant membership, onboarding, CRM foundations.
-- All tenant authorization is evaluated from auth.uid(); tenant IDs in client payloads
-- are identifiers, never proof of access.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TYPE public.membership_role AS ENUM ('owner', 'office', 'technician');
CREATE TYPE public.membership_status AS ENUM ('invited', 'active', 'deactivated');
CREATE TYPE public.tax_behavior AS ENUM ('exclusive', 'inclusive', 'non_taxable');

CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_full_name_length CHECK (char_length(full_name) <= 120)
);

CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL,
  display_name text NOT NULL,
  business_email text NOT NULL,
  phone text,
  street_address text,
  city text,
  state_code text,
  postal_code text,
  country_code text NOT NULL DEFAULT 'US',
  service_categories text[] NOT NULL DEFAULT '{}',
  time_zone text NOT NULL,
  currency_code text NOT NULL DEFAULT 'USD',
  tax_rate_bps integer NOT NULL DEFAULT 0,
  onboarding_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenants_legal_name_length CHECK (char_length(legal_name) BETWEEN 2 AND 160),
  CONSTRAINT tenants_display_name_length CHECK (char_length(display_name) BETWEEN 2 AND 120),
  CONSTRAINT tenants_country_us_only CHECK (country_code = 'US'),
  CONSTRAINT tenants_currency_usd_only CHECK (currency_code = 'USD'),
  CONSTRAINT tenants_state_code_format CHECK (state_code IS NULL OR state_code ~ '^[A-Z]{2}$'),
  CONSTRAINT tenants_postal_code_format CHECK (postal_code IS NULL OR postal_code ~ '^\d{5}(-\d{4})?$'),
  CONSTRAINT tenants_time_zone_supported CHECK (
    time_zone = ANY (ARRAY[
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Phoenix',
      'America/Los_Angeles',
      'America/Anchorage',
      'Pacific/Honolulu'
    ])
  ),
  CONSTRAINT tenants_service_categories_present CHECK (cardinality(service_categories) > 0),
  CONSTRAINT tenants_tax_rate_range CHECK (tax_rate_bps BETWEEN 0 AND 10000)
);

CREATE TABLE public.memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  role public.membership_role NOT NULL,
  status public.membership_status NOT NULL DEFAULT 'active',
  invited_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  joined_at timestamptz,
  deactivated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memberships_tenant_user_unique UNIQUE (tenant_id, user_id),
  CONSTRAINT memberships_status_timestamps CHECK (
    (status = 'active' AND joined_at IS NOT NULL AND deactivated_at IS NULL)
    OR (status = 'invited' AND joined_at IS NULL AND deactivated_at IS NULL)
    OR (status = 'deactivated' AND deactivated_at IS NOT NULL)
  )
);

-- v1 invariant: a person has one active business membership.
CREATE UNIQUE INDEX memberships_one_active_tenant_per_user
  ON public.memberships (user_id)
  WHERE status = 'active';
CREATE INDEX memberships_tenant_id_idx ON public.memberships (tenant_id);

CREATE TABLE public.tenant_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE RESTRICT,
  notifications_enabled boolean NOT NULL DEFAULT true,
  ai_operations_enabled boolean NOT NULL DEFAULT false,
  ai_monthly_budget_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_settings_ai_budget_nonnegative CHECK (ai_monthly_budget_cents >= 0)
);

CREATE TABLE public.business_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  day_of_week smallint NOT NULL,
  is_open boolean NOT NULL DEFAULT true,
  opens_at time,
  closes_at time,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_hours_tenant_day_unique UNIQUE (tenant_id, day_of_week),
  CONSTRAINT business_hours_day_range CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT business_hours_opening_window CHECK (
    (is_open AND opens_at IS NOT NULL AND closes_at IS NOT NULL AND opens_at < closes_at)
    OR (NOT is_open AND opens_at IS NULL AND closes_at IS NULL)
  )
);
CREATE INDEX business_hours_tenant_id_idx ON public.business_hours (tenant_id);

CREATE TABLE public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  name text NOT NULL,
  description text,
  unit_price_cents integer NOT NULL,
  default_duration_minutes integer NOT NULL,
  tax_behavior public.tax_behavior NOT NULL DEFAULT 'exclusive',
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT services_name_length CHECK (char_length(name) BETWEEN 2 AND 120),
  CONSTRAINT services_price_nonnegative CHECK (unit_price_cents >= 0),
  CONSTRAINT services_duration_range CHECK (default_duration_minutes BETWEEN 5 AND 1440),
  CONSTRAINT services_tenant_name_unique UNIQUE (tenant_id, name)
);
CREATE INDEX services_tenant_id_idx ON public.services (tenant_id);

CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text,
  phone text,
  street_address text,
  address_line_2 text,
  city text,
  state_code text,
  postal_code text,
  notes text,
  transactional_email_allowed boolean NOT NULL DEFAULT true,
  marketing_email_opted_in boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT customers_first_name_length CHECK (char_length(first_name) BETWEEN 1 AND 80),
  CONSTRAINT customers_last_name_length CHECK (char_length(last_name) BETWEEN 1 AND 80),
  CONSTRAINT customers_state_code_format CHECK (state_code IS NULL OR state_code ~ '^[A-Z]{2}$'),
  CONSTRAINT customers_postal_code_format CHECK (postal_code IS NULL OR postal_code ~ '^\d{5}(-\d{4})?$')
);
CREATE INDEX customers_tenant_id_idx ON public.customers (tenant_id);
CREATE INDEX customers_tenant_name_idx ON public.customers (tenant_id, last_name, first_name);

CREATE TABLE public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_action_length CHECK (char_length(action) BETWEEN 2 AND 120),
  CONSTRAINT audit_events_entity_type_length CHECK (char_length(entity_type) BETWEEN 2 AND 80),
  CONSTRAINT audit_events_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX audit_events_tenant_time_idx ON public.audit_events (tenant_id, occurred_at DESC);
CREATE INDEX audit_events_correlation_id_idx ON public.audit_events (correlation_id);

CREATE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.reject_tenant_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.reject_membership_identity_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.user_id <> OLD.user_id THEN
    RAISE EXCEPTION 'membership tenant_id and user_id are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.current_user_has_tenant_role(
  target_tenant_id uuid,
  allowed_roles public.membership_role[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.memberships membership
    WHERE membership.tenant_id = target_tenant_id
      AND membership.user_id = auth.uid()
      AND membership.status = 'active'
      AND membership.role = ANY (allowed_roles)
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_has_tenant_role(uuid, public.membership_role[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_has_tenant_role(uuid, public.membership_role[]) TO authenticated;

CREATE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (NEW.id, left(coalesce(NEW.raw_user_meta_data ->> 'full_name', ''), 120));
  RETURN NEW;
END;
$$;

CREATE TRIGGER auth_user_created_profile
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

CREATE FUNCTION public.create_tenant_with_owner(
  legal_name text,
  display_name text,
  business_email text,
  phone text,
  street_address text,
  city text,
  state_code text,
  postal_code text,
  time_zone text,
  service_categories text[],
  tax_rate_bps integer DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_tenant_id uuid;
  current_user_id uuid := auth.uid();
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = current_user_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'user already has an active business membership' USING ERRCODE = '23505';
  END IF;

  IF char_length(trim(legal_name)) NOT BETWEEN 2 AND 160
    OR char_length(trim(display_name)) NOT BETWEEN 2 AND 120
    OR char_length(trim(business_email)) NOT BETWEEN 3 AND 254
    OR position('@' in trim(business_email)) < 2
    OR char_length(trim(street_address)) NOT BETWEEN 3 AND 180
    OR char_length(trim(city)) NOT BETWEEN 2 AND 100
    OR state_code !~ '^[A-Z]{2}$'
    OR postal_code !~ '^\d{5}(-\d{4})?$'
    OR time_zone <> ALL (ARRAY[
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Phoenix',
      'America/Los_Angeles',
      'America/Anchorage',
      'Pacific/Honolulu'
    ])
    OR cardinality(coalesce(service_categories, '{}')) < 1
    OR NOT coalesce(service_categories, '{}') <@ ARRAY[
      'HVAC',
      'Plumbing',
      'Electrical',
      'Cleaning',
      'Pest control',
      'Other'
    ]
    OR tax_rate_bps NOT BETWEEN 0 AND 10000 THEN
    RAISE EXCEPTION 'invalid onboarding data' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.tenants (
    legal_name,
    display_name,
    business_email,
    phone,
    street_address,
    city,
    state_code,
    postal_code,
    time_zone,
    service_categories,
    tax_rate_bps,
    onboarding_completed_at
  )
  VALUES (
    trim(legal_name),
    trim(display_name),
    lower(trim(business_email)),
    nullif(trim(phone), ''),
    nullif(trim(street_address), ''),
    nullif(trim(city), ''),
    upper(trim(state_code)),
    trim(postal_code),
    time_zone,
    coalesce(service_categories, '{}'),
    tax_rate_bps,
    now()
  )
  RETURNING id INTO new_tenant_id;

  INSERT INTO public.memberships (tenant_id, user_id, role, status, joined_at)
  VALUES (new_tenant_id, current_user_id, 'owner', 'active', now());

  INSERT INTO public.tenant_settings (tenant_id)
  VALUES (new_tenant_id);

  INSERT INTO public.business_hours (tenant_id, day_of_week, is_open, opens_at, closes_at)
  SELECT
    new_tenant_id,
    day_number,
    day_number BETWEEN 1 AND 5,
    CASE WHEN day_number BETWEEN 1 AND 5 THEN '09:00'::time ELSE NULL END,
    CASE WHEN day_number BETWEEN 1 AND 5 THEN '17:00'::time ELSE NULL END
  FROM generate_series(0, 6) AS day_number;

  INSERT INTO public.audit_events (
    tenant_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  VALUES (
    new_tenant_id,
    current_user_id,
    'tenant.created',
    'tenant',
    new_tenant_id,
    jsonb_build_object('source', 'owner_onboarding')
  );

  RETURN new_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_tenant_with_owner(
  text, text, text, text, text, text, text, text, text, text[], integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_tenant_with_owner(
  text, text, text, text, text, text, text, text, text, text[], integer
) TO authenticated;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER memberships_updated_at BEFORE UPDATE ON public.memberships
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tenant_settings_updated_at BEFORE UPDATE ON public.tenant_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER business_hours_updated_at BEFORE UPDATE ON public.business_hours
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER services_updated_at BEFORE UPDATE ON public.services
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER memberships_identity_immutable BEFORE UPDATE ON public.memberships
FOR EACH ROW EXECUTE FUNCTION public.reject_membership_identity_change();
CREATE TRIGGER tenant_settings_tenant_immutable BEFORE UPDATE ON public.tenant_settings
FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_change();
CREATE TRIGGER business_hours_tenant_immutable BEFORE UPDATE ON public.business_hours
FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_change();
CREATE TRIGGER services_tenant_immutable BEFORE UPDATE ON public.services
FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_change();
CREATE TRIGGER customers_tenant_immutable BEFORE UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_change();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_read_self ON public.profiles
FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY profiles_update_self ON public.profiles
FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY tenants_read_members ON public.tenants
FOR SELECT TO authenticated USING (
  public.current_user_has_tenant_role(id, ARRAY['owner', 'office', 'technician']::public.membership_role[])
);
CREATE POLICY tenants_update_owner ON public.tenants
FOR UPDATE TO authenticated USING (
  public.current_user_has_tenant_role(id, ARRAY['owner']::public.membership_role[])
) WITH CHECK (
  public.current_user_has_tenant_role(id, ARRAY['owner']::public.membership_role[])
);

CREATE POLICY memberships_read_authorized ON public.memberships
FOR SELECT TO authenticated USING (
  user_id = auth.uid()
  OR public.current_user_has_tenant_role(tenant_id, ARRAY['owner', 'office']::public.membership_role[])
);
CREATE POLICY memberships_insert_owner ON public.memberships
FOR INSERT TO authenticated WITH CHECK (
  public.current_user_has_tenant_role(tenant_id, ARRAY['owner']::public.membership_role[])
);
CREATE POLICY memberships_update_owner ON public.memberships
FOR UPDATE TO authenticated USING (
  public.current_user_has_tenant_role(tenant_id, ARRAY['owner']::public.membership_role[])
) WITH CHECK (
  public.current_user_has_tenant_role(tenant_id, ARRAY['owner']::public.membership_role[])
);

CREATE POLICY tenant_settings_read_office ON public.tenant_settings
FOR SELECT TO authenticated USING (
  public.current_user_has_tenant_role(tenant_id, ARRAY['owner', 'office']::public.membership_role[])
);
CREATE POLICY tenant_settings_update_owner ON public.tenant_settings
FOR UPDATE TO authenticated USING (
  public.current_user_has_tenant_role(tenant_id, ARRAY['owner']::public.membership_role[])
) WITH CHECK (
  public.current_user_has_tenant_role(tenant_id, ARRAY['owner']::public.membership_role[])
);

CREATE POLICY business_hours_read_members ON public.business_hours
FOR SELECT TO authenticated USING (
  public.current_user_has_tenant_role(tenant_id, ARRAY['owner', 'office', 'technician']::public.membership_role[])
);
CREATE POLICY business_hours_manage_office ON public.business_hours
FOR ALL TO authenticated USING (
  public.current_user_has_tenant_role(tenant_id, ARRAY['owner', 'office']::public.membership_role[])
) WITH CHECK (
  public.current_user_has_tenant_role(tenant_id, ARRAY['owner', 'office']::public.membership_role[])
);

CREATE POLICY services_read_members ON public.services
FOR SELECT TO authenticated USING (
  public.current_user_has_tenant_role(tenant_id, ARRAY['owner', 'office', 'technician']::public.membership_role[])
);
CREATE POLICY services_manage_office ON public.services
FOR ALL TO authenticated USING (
  public.current_user_has_tenant_role(tenant_id, ARRAY['owner', 'office']::public.membership_role[])
) WITH CHECK (
  public.current_user_has_tenant_role(tenant_id, ARRAY['owner', 'office']::public.membership_role[])
);

CREATE POLICY customers_manage_office ON public.customers
FOR ALL TO authenticated USING (
  public.current_user_has_tenant_role(tenant_id, ARRAY['owner', 'office']::public.membership_role[])
) WITH CHECK (
  public.current_user_has_tenant_role(tenant_id, ARRAY['owner', 'office']::public.membership_role[])
);

CREATE POLICY audit_events_read_office ON public.audit_events
FOR SELECT TO authenticated USING (
  public.current_user_has_tenant_role(tenant_id, ARRAY['owner', 'office']::public.membership_role[])
);

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, UPDATE ON public.tenants TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.memberships TO authenticated;
GRANT SELECT, UPDATE ON public.tenant_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.business_hours TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.services TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.customers TO authenticated;
GRANT SELECT ON public.audit_events TO authenticated;

COMMENT ON FUNCTION public.create_tenant_with_owner(
  text, text, text, text, text, text, text, text, text, text[], integer
) IS 'Creates the authenticated user''s only active v1 tenant membership and onboarding defaults.';
