-- CrewFlow Phase 1: secure team invitations, staff metadata, availability,
-- membership lifecycle controls, and resource audit coverage.

CREATE TABLE public.team_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  email text NOT NULL,
  role public.membership_role NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  invited_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_invitations_email_normalized CHECK (
    email = lower(trim(email)) AND char_length(email) BETWEEN 3 AND 254
  ),
  CONSTRAINT team_invitations_token_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT team_invitations_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT team_invitations_acceptance_consistent CHECK (
    (accepted_at IS NULL AND accepted_by_user_id IS NULL)
    OR (accepted_at IS NOT NULL AND accepted_by_user_id IS NOT NULL)
  ),
  CONSTRAINT team_invitations_terminal_state CHECK (
    accepted_at IS NULL OR revoked_at IS NULL
  )
);

CREATE INDEX team_invitations_tenant_created_idx
  ON public.team_invitations (tenant_id, created_at DESC);
CREATE UNIQUE INDEX team_invitations_one_pending_email
  ON public.team_invitations (tenant_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE public.staff_profiles (
  membership_id uuid PRIMARY KEY REFERENCES public.memberships(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  full_name text NOT NULL,
  skills text[] NOT NULL DEFAULT '{}',
  service_area_postal_codes text[] NOT NULL DEFAULT '{}',
  availability_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_profiles_membership_tenant_unique UNIQUE (membership_id, tenant_id),
  CONSTRAINT staff_profiles_full_name_length CHECK (char_length(full_name) BETWEEN 1 AND 120),
  CONSTRAINT staff_profiles_skills_limit CHECK (cardinality(skills) <= 30),
  CONSTRAINT staff_profiles_service_areas_limit CHECK (cardinality(service_area_postal_codes) <= 50),
  CONSTRAINT staff_profiles_notes_length CHECK (
    availability_notes IS NULL OR char_length(availability_notes) <= 1000
  )
);

CREATE INDEX staff_profiles_tenant_id_idx ON public.staff_profiles (tenant_id);

CREATE TABLE public.staff_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  membership_id uuid NOT NULL,
  day_of_week smallint NOT NULL,
  is_available boolean NOT NULL DEFAULT false,
  starts_at time,
  ends_at time,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_availability_membership_tenant_fk
    FOREIGN KEY (membership_id, tenant_id)
    REFERENCES public.staff_profiles(membership_id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT staff_availability_member_day_unique UNIQUE (membership_id, day_of_week),
  CONSTRAINT staff_availability_day_range CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT staff_availability_window CHECK (
    (is_available AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND starts_at < ends_at)
    OR (NOT is_available AND starts_at IS NULL AND ends_at IS NULL)
  )
);

CREATE INDEX staff_availability_tenant_id_idx ON public.staff_availability (tenant_id);

CREATE FUNCTION public.ensure_staff_profile_for_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  member_name text;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(
    nullif(trim(profile.full_name), ''),
    nullif(trim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(auth_user.email, '@', 1), ''),
    'Team member'
  )
  INTO member_name
  FROM auth.users AS auth_user
  LEFT JOIN public.profiles AS profile ON profile.user_id = auth_user.id
  WHERE auth_user.id = NEW.user_id;

  INSERT INTO public.staff_profiles (membership_id, tenant_id, full_name)
  VALUES (NEW.id, NEW.tenant_id, left(coalesce(member_name, 'Team member'), 120))
  ON CONFLICT (membership_id) DO NOTHING;

  INSERT INTO public.staff_availability (
    tenant_id,
    membership_id,
    day_of_week,
    is_available,
    starts_at,
    ends_at
  )
  SELECT
    NEW.tenant_id,
    NEW.id,
    business_hour.day_of_week,
    business_hour.is_open,
    business_hour.opens_at,
    business_hour.closes_at
  FROM public.business_hours AS business_hour
  WHERE business_hour.tenant_id = NEW.tenant_id
  ON CONFLICT (membership_id, day_of_week) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_staff_profile_for_membership() FROM PUBLIC;

CREATE TRIGGER memberships_ensure_staff_profile
AFTER INSERT OR UPDATE OF status ON public.memberships
FOR EACH ROW EXECUTE FUNCTION public.ensure_staff_profile_for_membership();

CREATE FUNCTION public.seed_staff_availability_from_business_hour()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.staff_availability (
    tenant_id,
    membership_id,
    day_of_week,
    is_available,
    starts_at,
    ends_at
  )
  SELECT
    NEW.tenant_id,
    staff_profile.membership_id,
    NEW.day_of_week,
    NEW.is_open,
    NEW.opens_at,
    NEW.closes_at
  FROM public.staff_profiles AS staff_profile
  JOIN public.memberships AS membership ON membership.id = staff_profile.membership_id
  WHERE staff_profile.tenant_id = NEW.tenant_id
    AND membership.status = 'active'
  ON CONFLICT (membership_id, day_of_week) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_staff_availability_from_business_hour() FROM PUBLIC;

CREATE TRIGGER business_hours_seed_staff_availability
AFTER INSERT ON public.business_hours
FOR EACH ROW EXECUTE FUNCTION public.seed_staff_availability_from_business_hour();

INSERT INTO public.staff_profiles (membership_id, tenant_id, full_name)
SELECT
  membership.id,
  membership.tenant_id,
  left(coalesce(
    nullif(trim(profile.full_name), ''),
    nullif(trim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(auth_user.email, '@', 1), ''),
    'Team member'
  ), 120)
FROM public.memberships AS membership
JOIN auth.users AS auth_user ON auth_user.id = membership.user_id
LEFT JOIN public.profiles AS profile ON profile.user_id = membership.user_id
WHERE membership.status = 'active'
ON CONFLICT (membership_id) DO NOTHING;

INSERT INTO public.staff_availability (
  tenant_id,
  membership_id,
  day_of_week,
  is_available,
  starts_at,
  ends_at
)
SELECT
  staff_profile.tenant_id,
  staff_profile.membership_id,
  business_hour.day_of_week,
  business_hour.is_open,
  business_hour.opens_at,
  business_hour.closes_at
FROM public.staff_profiles AS staff_profile
JOIN public.business_hours AS business_hour
  ON business_hour.tenant_id = staff_profile.tenant_id
ON CONFLICT (membership_id, day_of_week) DO NOTHING;

CREATE FUNCTION public.create_team_invitation(
  invitee_email text,
  invitee_role public.membership_role,
  expiry_hours integer DEFAULT 72
)
RETURNS TABLE (
  invitation_id uuid,
  invitation_token text,
  invitation_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_tenant_id uuid;
  current_user_id uuid := auth.uid();
  generated_token text;
  normalized_email text := lower(trim(invitee_email));
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT membership.tenant_id
  INTO actor_tenant_id
  FROM public.memberships AS membership
  WHERE membership.user_id = current_user_id
    AND membership.status = 'active'
    AND membership.role = 'owner';

  IF actor_tenant_id IS NULL THEN
    RAISE EXCEPTION 'owner role required' USING ERRCODE = '42501';
  END IF;

  IF normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR char_length(normalized_email) > 254
    OR invitee_role IS NULL
    OR expiry_hours NOT BETWEEN 1 AND 168 THEN
    RAISE EXCEPTION 'invalid invitation data' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.memberships AS membership
    JOIN auth.users AS auth_user ON auth_user.id = membership.user_id
    WHERE membership.tenant_id = actor_tenant_id
      AND lower(auth_user.email) = normalized_email
      AND membership.status = 'active'
  ) THEN
    RAISE EXCEPTION 'user is already an active team member' USING ERRCODE = '23505';
  END IF;

  UPDATE public.team_invitations AS invitation
  SET revoked_at = now()
  WHERE invitation.tenant_id = actor_tenant_id
    AND invitation.email = normalized_email
    AND invitation.accepted_at IS NULL
    AND invitation.revoked_at IS NULL;

  generated_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO public.team_invitations (
    tenant_id,
    email,
    role,
    token_hash,
    expires_at,
    invited_by_user_id
  )
  VALUES (
    actor_tenant_id,
    normalized_email,
    invitee_role,
    pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(generated_token, 'UTF8'), 'sha256'),
      'hex'
    ),
    now() + pg_catalog.make_interval(hours => expiry_hours),
    current_user_id
  )
  RETURNING id, expires_at
  INTO invitation_id, invitation_expires_at;

  invitation_token := generated_token;

  INSERT INTO public.audit_events (
    tenant_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  VALUES (
    actor_tenant_id,
    current_user_id,
    'team.invitation_created',
    'team_invitation',
    invitation_id,
    pg_catalog.jsonb_build_object('role', invitee_role, 'expires_at', invitation_expires_at)
  );

  RETURN NEXT;
END;
$$;

CREATE FUNCTION public.revoke_team_invitation(target_invitation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_tenant_id uuid;
  current_user_id uuid := auth.uid();
BEGIN
  SELECT membership.tenant_id
  INTO actor_tenant_id
  FROM public.memberships AS membership
  WHERE membership.user_id = current_user_id
    AND membership.status = 'active'
    AND membership.role = 'owner';

  IF actor_tenant_id IS NULL THEN
    RAISE EXCEPTION 'owner role required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.team_invitations AS invitation
  SET revoked_at = now()
  WHERE invitation.id = target_invitation_id
    AND invitation.tenant_id = actor_tenant_id
    AND invitation.accepted_at IS NULL
    AND invitation.revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'pending invitation not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id
  )
  VALUES (
    actor_tenant_id,
    current_user_id,
    'team.invitation_revoked',
    'team_invitation',
    target_invitation_id
  );
END;
$$;

CREATE FUNCTION public.accept_team_invitation(invitation_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  current_email text;
  current_name text;
  target_invitation public.team_invitations%ROWTYPE;
  target_membership_id uuid;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF invitation_token IS NULL OR invitation_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid or expired invitation' USING ERRCODE = '22023';
  END IF;

  SELECT lower(auth_user.email), coalesce(
    nullif(trim(profile.full_name), ''),
    nullif(trim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(auth_user.email, '@', 1), ''),
    'Team member'
  )
  INTO current_email, current_name
  FROM auth.users AS auth_user
  LEFT JOIN public.profiles AS profile ON profile.user_id = auth_user.id
  WHERE auth_user.id = current_user_id
    AND auth_user.email_confirmed_at IS NOT NULL;

  IF current_email IS NULL THEN
    RAISE EXCEPTION 'verified email required' USING ERRCODE = '42501';
  END IF;

  SELECT invitation.*
  INTO target_invitation
  FROM public.team_invitations AS invitation
  WHERE invitation.token_hash = pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(invitation_token, 'UTF8'), 'sha256'),
    'hex'
  )
  FOR UPDATE;

  IF target_invitation.id IS NULL
    OR target_invitation.accepted_at IS NOT NULL
    OR target_invitation.revoked_at IS NOT NULL
    OR target_invitation.expires_at <= now()
    OR target_invitation.email <> current_email THEN
    RAISE EXCEPTION 'invalid or expired invitation' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.memberships AS membership
    WHERE membership.user_id = current_user_id
      AND membership.status = 'active'
  ) THEN
    RAISE EXCEPTION 'user already has an active business membership' USING ERRCODE = '23505';
  END IF;

  SELECT membership.id
  INTO target_membership_id
  FROM public.memberships AS membership
  WHERE membership.tenant_id = target_invitation.tenant_id
    AND membership.user_id = current_user_id
  FOR UPDATE;

  IF target_membership_id IS NULL THEN
    INSERT INTO public.memberships (
      tenant_id,
      user_id,
      role,
      status,
      invited_by_user_id,
      joined_at
    )
    VALUES (
      target_invitation.tenant_id,
      current_user_id,
      target_invitation.role,
      'active',
      target_invitation.invited_by_user_id,
      now()
    )
    RETURNING id INTO target_membership_id;
  ELSE
    UPDATE public.memberships
    SET
      role = target_invitation.role,
      status = 'active',
      invited_by_user_id = target_invitation.invited_by_user_id,
      joined_at = now(),
      deactivated_at = NULL
    WHERE id = target_membership_id;
  END IF;

  UPDATE public.staff_profiles
  SET full_name = left(current_name, 120)
  WHERE membership_id = target_membership_id;

  UPDATE public.team_invitations
  SET accepted_at = now(), accepted_by_user_id = current_user_id
  WHERE id = target_invitation.id;

  INSERT INTO public.audit_events (
    tenant_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  VALUES (
    target_invitation.tenant_id,
    current_user_id,
    'team.invitation_accepted',
    'membership',
    target_membership_id,
    pg_catalog.jsonb_build_object('role', target_invitation.role)
  );

  RETURN target_invitation.tenant_id;
END;
$$;

CREATE FUNCTION public.update_team_member_role(
  target_membership_id uuid,
  new_role public.membership_role
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_tenant_id uuid;
  current_user_id uuid := auth.uid();
  previous_role public.membership_role;
BEGIN
  SELECT membership.tenant_id
  INTO actor_tenant_id
  FROM public.memberships AS membership
  WHERE membership.user_id = current_user_id
    AND membership.status = 'active'
    AND membership.role = 'owner';

  IF actor_tenant_id IS NULL OR new_role IS NULL THEN
    RAISE EXCEPTION 'owner role required' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.memberships AS membership
  WHERE membership.tenant_id = actor_tenant_id
    AND membership.status = 'active'
    AND membership.role = 'owner'
  FOR UPDATE;

  SELECT membership.role
  INTO previous_role
  FROM public.memberships AS membership
  WHERE membership.id = target_membership_id
    AND membership.tenant_id = actor_tenant_id
    AND membership.status = 'active'
  FOR UPDATE;

  IF previous_role IS NULL THEN
    RAISE EXCEPTION 'active team member not found' USING ERRCODE = 'P0002';
  END IF;

  IF previous_role = 'owner'
    AND new_role <> 'owner'
    AND (
      SELECT count(*)
      FROM public.memberships AS membership
      WHERE membership.tenant_id = actor_tenant_id
        AND membership.status = 'active'
        AND membership.role = 'owner'
    ) <= 1 THEN
    RAISE EXCEPTION 'the workspace must keep at least one active owner' USING ERRCODE = '23514';
  END IF;

  IF previous_role = new_role THEN
    RETURN;
  END IF;

  UPDATE public.memberships SET role = new_role WHERE id = target_membership_id;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  )
  VALUES (
    actor_tenant_id,
    current_user_id,
    'team.role_changed',
    'membership',
    target_membership_id,
    pg_catalog.jsonb_build_object('from', previous_role, 'to', new_role)
  );
END;
$$;

CREATE FUNCTION public.deactivate_team_member(target_membership_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_tenant_id uuid;
  current_user_id uuid := auth.uid();
  target_user_id uuid;
  target_role public.membership_role;
BEGIN
  SELECT membership.tenant_id
  INTO actor_tenant_id
  FROM public.memberships AS membership
  WHERE membership.user_id = current_user_id
    AND membership.status = 'active'
    AND membership.role = 'owner';

  IF actor_tenant_id IS NULL THEN
    RAISE EXCEPTION 'owner role required' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.memberships AS membership
  WHERE membership.tenant_id = actor_tenant_id
    AND membership.status = 'active'
    AND membership.role = 'owner'
  FOR UPDATE;

  SELECT membership.user_id, membership.role
  INTO target_user_id, target_role
  FROM public.memberships AS membership
  WHERE membership.id = target_membership_id
    AND membership.tenant_id = actor_tenant_id
    AND membership.status = 'active'
  FOR UPDATE;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'active team member not found' USING ERRCODE = 'P0002';
  END IF;

  IF target_user_id = current_user_id THEN
    RAISE EXCEPTION 'owners cannot deactivate their own account' USING ERRCODE = '23514';
  END IF;

  IF target_role = 'owner' AND (
    SELECT count(*)
    FROM public.memberships AS membership
    WHERE membership.tenant_id = actor_tenant_id
      AND membership.status = 'active'
      AND membership.role = 'owner'
  ) <= 1 THEN
    RAISE EXCEPTION 'the workspace must keep at least one active owner' USING ERRCODE = '23514';
  END IF;

  UPDATE public.memberships
  SET status = 'deactivated', deactivated_at = now()
  WHERE id = target_membership_id;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  )
  VALUES (
    actor_tenant_id,
    current_user_id,
    'team.member_deactivated',
    'membership',
    target_membership_id,
    pg_catalog.jsonb_build_object('role', target_role)
  );
END;
$$;

CREATE FUNCTION public.update_staff_details(
  target_membership_id uuid,
  staff_full_name text,
  staff_skills text[],
  staff_service_area_postal_codes text[],
  staff_availability_notes text,
  weekly_schedule jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  target_tenant_id uuid;
  actor_membership_id uuid;
  actor_role public.membership_role;
BEGIN
  SELECT membership.tenant_id
  INTO target_tenant_id
  FROM public.memberships AS membership
  WHERE membership.id = target_membership_id
    AND membership.status = 'active';

  SELECT membership.id, membership.role
  INTO actor_membership_id, actor_role
  FROM public.memberships AS membership
  WHERE membership.user_id = current_user_id
    AND membership.tenant_id = target_tenant_id
    AND membership.status = 'active';

  IF target_tenant_id IS NULL
    OR actor_membership_id IS NULL
    OR (actor_role = 'technician' AND actor_membership_id <> target_membership_id) THEN
    RAISE EXCEPTION 'staff profile access denied' USING ERRCODE = '42501';
  END IF;

  IF char_length(trim(staff_full_name)) NOT BETWEEN 1 AND 120
    OR cardinality(coalesce(staff_skills, '{}')) > 30
    OR cardinality(coalesce(staff_service_area_postal_codes, '{}')) > 50
    OR char_length(coalesce(staff_availability_notes, '')) > 1000
    OR EXISTS (
      SELECT 1 FROM unnest(coalesce(staff_skills, '{}')) AS skill
      WHERE char_length(trim(skill)) NOT BETWEEN 1 AND 80
    )
    OR EXISTS (
      SELECT 1 FROM unnest(coalesce(staff_service_area_postal_codes, '{}')) AS postal_code
      WHERE postal_code !~ '^\d{5}(-\d{4})?$'
    )
    OR pg_catalog.jsonb_typeof(weekly_schedule) <> 'array'
    OR pg_catalog.jsonb_array_length(weekly_schedule) > 7 THEN
    RAISE EXCEPTION 'invalid staff details' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(weekly_schedule) AS schedule_item
    WHERE (schedule_item ->> 'dayOfWeek')::integer NOT BETWEEN 0 AND 6
      OR (schedule_item ->> 'isAvailable')::boolean IS NULL
      OR (
        (schedule_item ->> 'isAvailable')::boolean
        AND (
          schedule_item ->> 'startsAt' IS NULL
          OR schedule_item ->> 'endsAt' IS NULL
          OR (schedule_item ->> 'startsAt')::time >= (schedule_item ->> 'endsAt')::time
        )
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(weekly_schedule) AS schedule_item
    GROUP BY schedule_item ->> 'dayOfWeek'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'invalid weekly schedule' USING ERRCODE = '22023';
  END IF;

  UPDATE public.staff_profiles
  SET
    full_name = trim(staff_full_name),
    skills = ARRAY(
      SELECT DISTINCT trim(skill)
      FROM unnest(coalesce(staff_skills, '{}')) AS skill
      ORDER BY trim(skill)
    ),
    service_area_postal_codes = ARRAY(
      SELECT DISTINCT trim(postal_code)
      FROM unnest(coalesce(staff_service_area_postal_codes, '{}')) AS postal_code
      ORDER BY trim(postal_code)
    ),
    availability_notes = nullif(trim(staff_availability_notes), '')
  WHERE membership_id = target_membership_id;

  DELETE FROM public.staff_availability
  WHERE membership_id = target_membership_id;

  INSERT INTO public.staff_availability (
    tenant_id,
    membership_id,
    day_of_week,
    is_available,
    starts_at,
    ends_at
  )
  SELECT
    target_tenant_id,
    target_membership_id,
    (schedule_item ->> 'dayOfWeek')::smallint,
    (schedule_item ->> 'isAvailable')::boolean,
    CASE
      WHEN (schedule_item ->> 'isAvailable')::boolean
      THEN (schedule_item ->> 'startsAt')::time
      ELSE NULL
    END,
    CASE
      WHEN (schedule_item ->> 'isAvailable')::boolean
      THEN (schedule_item ->> 'endsAt')::time
      ELSE NULL
    END
  FROM pg_catalog.jsonb_array_elements(weekly_schedule) AS schedule_item;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id
  )
  VALUES (
    target_tenant_id,
    current_user_id,
    'staff.details_updated',
    'membership',
    target_membership_id
  );
END;
$$;

CREATE FUNCTION public.record_tenant_resource_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  audit_action text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    audit_action := TG_TABLE_NAME || '.created';
  ELSIF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    audit_action := TG_TABLE_NAME || '.archived';
  ELSE
    audit_action := TG_TABLE_NAME || '.updated';
  END IF;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id
  )
  VALUES (NEW.tenant_id, auth.uid(), audit_action, TG_TABLE_NAME, NEW.id);

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.record_tenant_resource_audit() FROM PUBLIC;

CREATE TRIGGER customers_record_audit
AFTER INSERT OR UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.record_tenant_resource_audit();

CREATE TRIGGER services_record_audit
AFTER INSERT OR UPDATE ON public.services
FOR EACH ROW EXECUTE FUNCTION public.record_tenant_resource_audit();

CREATE TRIGGER team_invitations_updated_at
BEFORE UPDATE ON public.team_invitations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER staff_profiles_updated_at
BEFORE UPDATE ON public.staff_profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER staff_availability_updated_at
BEFORE UPDATE ON public.staff_availability
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER team_invitations_tenant_immutable
BEFORE UPDATE ON public.team_invitations
FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_change();
CREATE TRIGGER staff_profiles_tenant_immutable
BEFORE UPDATE ON public.staff_profiles
FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_change();
CREATE TRIGGER staff_availability_tenant_immutable
BEFORE UPDATE ON public.staff_availability
FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_change();

ALTER TABLE public.team_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY team_invitations_read_owner ON public.team_invitations
FOR SELECT TO authenticated USING (
  public.current_user_has_tenant_role(
    tenant_id,
    ARRAY['owner']::public.membership_role[]
  )
);

CREATE POLICY staff_profiles_read_authorized ON public.staff_profiles
FOR SELECT TO authenticated USING (
  public.current_user_has_tenant_role(
    tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  )
  OR EXISTS (
    SELECT 1
    FROM public.memberships AS membership
    WHERE membership.id = staff_profiles.membership_id
      AND membership.user_id = auth.uid()
      AND membership.status = 'active'
  )
);

CREATE POLICY staff_availability_read_authorized ON public.staff_availability
FOR SELECT TO authenticated USING (
  public.current_user_has_tenant_role(
    tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  )
  OR EXISTS (
    SELECT 1
    FROM public.memberships AS membership
    WHERE membership.id = staff_availability.membership_id
      AND membership.user_id = auth.uid()
      AND membership.status = 'active'
  )
);

DROP POLICY memberships_insert_owner ON public.memberships;
DROP POLICY memberships_update_owner ON public.memberships;

REVOKE INSERT, UPDATE ON public.memberships FROM authenticated;
GRANT SELECT ON public.team_invitations TO authenticated;
GRANT SELECT ON public.staff_profiles TO authenticated;
GRANT SELECT ON public.staff_availability TO authenticated;

REVOKE ALL ON FUNCTION public.create_team_invitation(
  text, public.membership_role, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_team_invitation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_team_invitation(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_team_member_role(
  uuid, public.membership_role
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.deactivate_team_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_staff_details(
  uuid, text, text[], text[], text, jsonb
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_team_invitation(
  text, public.membership_role, integer
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_team_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_team_invitation(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_team_member_role(
  uuid, public.membership_role
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_team_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_staff_details(
  uuid, text, text[], text[], text, jsonb
) TO authenticated;

COMMENT ON TABLE public.team_invitations IS
  'Expiring email invitations. Only SHA-256 token hashes are persisted.';
COMMENT ON FUNCTION public.accept_team_invitation(text) IS
  'Accepts an invitation only for the authenticated user with the matching verified email.';
COMMENT ON FUNCTION public.deactivate_team_member(uuid) IS
  'Immediately deactivates a team membership while retaining staff and audit history.';
