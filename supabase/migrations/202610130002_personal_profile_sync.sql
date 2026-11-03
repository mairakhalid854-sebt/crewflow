-- Keep authenticated profile metadata and tenant staff records synchronized.

CREATE FUNCTION public.sync_auth_user_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  normalized_full_name text := left(
    trim(coalesce(NEW.raw_user_meta_data ->> 'full_name', '')),
    120
  );
  old_full_name text := left(
    trim(coalesce(OLD.raw_user_meta_data ->> 'full_name', '')),
    120
  );
  active_membership_id uuid;
  active_tenant_id uuid;
BEGIN
  IF normalized_full_name IS NOT DISTINCT FROM old_full_name THEN
    RETURN NEW;
  END IF;

  IF char_length(normalized_full_name) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'invalid profile name' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.profiles (user_id, full_name)
  VALUES (NEW.id, normalized_full_name)
  ON CONFLICT (user_id) DO UPDATE
  SET full_name = EXCLUDED.full_name;

  SELECT membership.id, membership.tenant_id
  INTO active_membership_id, active_tenant_id
  FROM public.memberships AS membership
  WHERE membership.user_id = NEW.id
    AND membership.status = 'active';

  IF active_membership_id IS NOT NULL THEN
    UPDATE public.staff_profiles
    SET full_name = normalized_full_name
    WHERE membership_id = active_membership_id;

    INSERT INTO public.audit_events (
      tenant_id, actor_user_id, action, entity_type, entity_id
    )
    VALUES (
      active_tenant_id,
      NEW.id,
      'profile.updated',
      'profile',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_auth_user_profile_update() FROM PUBLIC;

CREATE TRIGGER auth_user_updated_profile
AFTER UPDATE OF raw_user_meta_data ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.sync_auth_user_profile_update();

COMMENT ON FUNCTION public.sync_auth_user_profile_update() IS
  'Validates and synchronizes user full-name changes to profiles and staff records.';
