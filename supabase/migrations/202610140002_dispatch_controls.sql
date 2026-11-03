-- CrewFlow Phase 2: dispatch constraints, service skill requirements, and
-- technician time off. Scheduling remains conflict-safe and tenant-scoped.

ALTER TABLE public.services
  ADD COLUMN required_skills text[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT services_required_skills_limit CHECK (
    cardinality(required_skills) <= 20
  );

CREATE TABLE public.staff_time_off (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  membership_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_time_off_membership_tenant_fk
    FOREIGN KEY (membership_id, tenant_id)
    REFERENCES public.memberships(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT staff_time_off_window CHECK (starts_at < ends_at),
  CONSTRAINT staff_time_off_reason_length CHECK (
    reason IS NULL OR char_length(reason) <= 500
  )
);

CREATE INDEX staff_time_off_tenant_window_idx
  ON public.staff_time_off (tenant_id, starts_at, ends_at);
CREATE INDEX staff_time_off_member_window_idx
  ON public.staff_time_off (membership_id, starts_at, ends_at);

ALTER TABLE public.staff_time_off
  ADD CONSTRAINT staff_time_off_no_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    membership_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (cancelled_at IS NULL);

CREATE FUNCTION public.validate_staff_time_off_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  member_is_technician boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships AS membership
    WHERE membership.id = NEW.membership_id
      AND membership.tenant_id = NEW.tenant_id
      AND membership.role = 'technician'
      AND (TG_OP = 'UPDATE' OR membership.status = 'active')
  )
  INTO member_is_technician;

  IF NOT member_is_technician THEN
    RAISE EXCEPTION 'time off must belong to a technician in the same tenant'
      USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by_user_id := auth.uid();
  ELSE
    NEW.created_by_user_id := OLD.created_by_user_id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_staff_time_off_write() FROM PUBLIC;

CREATE FUNCTION public.record_staff_time_off_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.audit_events (
    tenant_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  VALUES (
    NEW.tenant_id,
    auth.uid(),
    CASE
      WHEN TG_OP = 'INSERT' THEN 'staff_time_off.created'
      WHEN NEW.cancelled_at IS NOT NULL AND OLD.cancelled_at IS NULL
        THEN 'staff_time_off.cancelled'
      ELSE 'staff_time_off.updated'
    END,
    'staff_time_off',
    NEW.id,
    jsonb_build_object(
      'membership_id', NEW.membership_id,
      'starts_at', NEW.starts_at,
      'ends_at', NEW.ends_at
    )
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.record_staff_time_off_activity() FROM PUBLIC;

CREATE TRIGGER staff_time_off_validate_write
BEFORE INSERT OR UPDATE ON public.staff_time_off
FOR EACH ROW EXECUTE FUNCTION public.validate_staff_time_off_write();

CREATE TRIGGER staff_time_off_updated_at
BEFORE UPDATE ON public.staff_time_off
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER staff_time_off_tenant_immutable
BEFORE UPDATE ON public.staff_time_off
FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_change();

CREATE TRIGGER staff_time_off_record_activity
AFTER INSERT OR UPDATE ON public.staff_time_off
FOR EACH ROW EXECUTE FUNCTION public.record_staff_time_off_activity();

ALTER TABLE public.staff_time_off ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_time_off_read_authorized ON public.staff_time_off
FOR SELECT TO authenticated USING (
  public.current_user_has_tenant_role(
    tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  )
  OR EXISTS (
    SELECT 1
    FROM public.memberships AS membership
    WHERE membership.id = staff_time_off.membership_id
      AND membership.tenant_id = staff_time_off.tenant_id
      AND membership.user_id = auth.uid()
      AND membership.role = 'technician'
      AND membership.status = 'active'
  )
);

CREATE POLICY staff_time_off_manage_office ON public.staff_time_off
FOR ALL TO authenticated USING (
  public.current_user_has_tenant_role(
    tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  )
) WITH CHECK (
  public.current_user_has_tenant_role(
    tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  )
);

REVOKE ALL ON public.staff_time_off FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.staff_time_off TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_job_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  assignee_is_active_technician boolean;
  assignee_is_available boolean;
  assignee_skills text[];
  local_end timestamp;
  local_start timestamp;
  required_service_skills text[];
  tenant_time_zone text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by_user_id := auth.uid();
  ELSE
    NEW.created_by_user_id := OLD.created_by_user_id;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status <> 'new' THEN
    RAISE EXCEPTION 'new jobs must start in the new state' USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status <> OLD.status THEN
    IF NOT (
      (OLD.status = 'new' AND NEW.status IN ('quoted', 'cancelled'))
      OR (OLD.status = 'quoted' AND NEW.status IN ('accepted', 'cancelled'))
      OR (OLD.status = 'accepted' AND NEW.status IN ('scheduled', 'cancelled'))
      OR (OLD.status = 'scheduled' AND NEW.status IN ('in_progress', 'cancelled'))
      OR (OLD.status = 'in_progress' AND NEW.status IN ('completed', 'cancelled'))
      OR (OLD.status = 'completed' AND NEW.status = 'closed')
    ) THEN
      RAISE EXCEPTION 'invalid job status transition from % to %', OLD.status, NEW.status
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NEW.assigned_membership_id IS NOT NULL THEN
    SELECT
      membership.role = 'technician' AND membership.status = 'active',
      staff_profile.skills
    INTO assignee_is_active_technician, assignee_skills
    FROM public.memberships AS membership
    JOIN public.staff_profiles AS staff_profile
      ON staff_profile.membership_id = membership.id
      AND staff_profile.tenant_id = membership.tenant_id
    WHERE membership.id = NEW.assigned_membership_id
      AND membership.tenant_id = NEW.tenant_id;

    IF NOT coalesce(assignee_is_active_technician, false) THEN
      RAISE EXCEPTION 'job assignee must be an active technician in the same tenant'
        USING ERRCODE = '22023';
    END IF;

    IF NEW.service_id IS NOT NULL THEN
      SELECT service.required_skills
      INTO required_service_skills
      FROM public.services AS service
      WHERE service.id = NEW.service_id
        AND service.tenant_id = NEW.tenant_id;

      IF EXISTS (
        SELECT 1
        FROM unnest(coalesce(required_service_skills, '{}')) AS required_skill
        WHERE NOT EXISTS (
          SELECT 1
          FROM unnest(coalesce(assignee_skills, '{}')) AS staff_skill
          WHERE lower(trim(staff_skill)) = lower(trim(required_skill))
        )
      ) THEN
        RAISE EXCEPTION 'technician does not have all required service skills'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    IF NEW.scheduled_start_at IS NOT NULL AND NEW.scheduled_end_at IS NOT NULL THEN
      SELECT tenant.time_zone
      INTO tenant_time_zone
      FROM public.tenants AS tenant
      WHERE tenant.id = NEW.tenant_id;

      local_start := NEW.scheduled_start_at AT TIME ZONE tenant_time_zone;
      local_end := NEW.scheduled_end_at AT TIME ZONE tenant_time_zone;

      IF local_start::date <> local_end::date THEN
        RAISE EXCEPTION 'job schedule must start and end on the same local day'
          USING ERRCODE = '22023';
      END IF;

      SELECT EXISTS (
        SELECT 1
        FROM public.staff_availability AS availability
        WHERE availability.membership_id = NEW.assigned_membership_id
          AND availability.tenant_id = NEW.tenant_id
          AND availability.day_of_week = extract(dow FROM local_start)::smallint
          AND availability.is_available
          AND availability.starts_at <= local_start::time
          AND availability.ends_at >= local_end::time
      )
      INTO assignee_is_available;

      IF NOT assignee_is_available THEN
        RAISE EXCEPTION 'job schedule falls outside technician weekly availability'
          USING ERRCODE = '22023';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM public.staff_time_off AS time_off
        WHERE time_off.membership_id = NEW.assigned_membership_id
          AND time_off.tenant_id = NEW.tenant_id
          AND time_off.cancelled_at IS NULL
          AND time_off.starts_at < NEW.scheduled_end_at
          AND time_off.ends_at > NEW.scheduled_start_at
      ) THEN
        RAISE EXCEPTION 'job schedule overlaps technician time off'
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON COLUMN public.services.required_skills IS
  'Case-insensitive skill names that every assigned technician must have.';
COMMENT ON TABLE public.staff_time_off IS
  'Audited technician unavailability used by dispatch validation.';
