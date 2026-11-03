-- CrewFlow Phase 2: tenant-safe jobs, explicit workflow transitions,
-- technician assignment, schedule conflict prevention, and activity events.

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

CREATE TYPE public.job_priority AS ENUM ('low', 'normal', 'high', 'urgent');
CREATE TYPE public.job_status AS ENUM (
  'new',
  'quoted',
  'accepted',
  'scheduled',
  'in_progress',
  'completed',
  'closed',
  'cancelled'
);

ALTER TABLE public.customers
  ADD CONSTRAINT customers_id_tenant_unique UNIQUE (id, tenant_id);
ALTER TABLE public.services
  ADD CONSTRAINT services_id_tenant_unique UNIQUE (id, tenant_id);
ALTER TABLE public.memberships
  ADD CONSTRAINT memberships_id_tenant_unique UNIQUE (id, tenant_id);

CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL,
  service_id uuid,
  assigned_membership_id uuid,
  title text NOT NULL,
  description text,
  priority public.job_priority NOT NULL DEFAULT 'normal',
  status public.job_status NOT NULL DEFAULT 'new',
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT jobs_customer_tenant_fk
    FOREIGN KEY (customer_id, tenant_id)
    REFERENCES public.customers(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT jobs_service_tenant_fk
    FOREIGN KEY (service_id, tenant_id)
    REFERENCES public.services(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT jobs_assignee_tenant_fk
    FOREIGN KEY (assigned_membership_id, tenant_id)
    REFERENCES public.memberships(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT jobs_title_length CHECK (char_length(title) BETWEEN 2 AND 160),
  CONSTRAINT jobs_description_length CHECK (
    description IS NULL OR char_length(description) <= 5000
  ),
  CONSTRAINT jobs_schedule_pair CHECK (
    (scheduled_start_at IS NULL AND scheduled_end_at IS NULL)
    OR (
      scheduled_start_at IS NOT NULL
      AND scheduled_end_at IS NOT NULL
      AND scheduled_start_at < scheduled_end_at
    )
  ),
  CONSTRAINT jobs_scheduled_state_complete CHECK (
    status NOT IN ('scheduled', 'in_progress', 'completed', 'closed')
    OR (
      assigned_membership_id IS NOT NULL
      AND scheduled_start_at IS NOT NULL
      AND scheduled_end_at IS NOT NULL
    )
  )
);

CREATE INDEX jobs_tenant_updated_idx
  ON public.jobs (tenant_id, updated_at DESC);
CREATE INDEX jobs_tenant_status_schedule_idx
  ON public.jobs (tenant_id, status, scheduled_start_at);
CREATE INDEX jobs_customer_idx ON public.jobs (customer_id);
CREATE INDEX jobs_assignee_schedule_idx
  ON public.jobs (assigned_membership_id, scheduled_start_at);

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_no_technician_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    assigned_membership_id WITH =,
    tstzrange(scheduled_start_at, scheduled_end_at, '[)') WITH &&
  )
  WHERE (
    assigned_membership_id IS NOT NULL
    AND scheduled_start_at IS NOT NULL
    AND scheduled_end_at IS NOT NULL
    AND archived_at IS NULL
    AND status IN ('scheduled', 'in_progress')
  );

CREATE FUNCTION public.validate_job_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  assignee_is_active_technician boolean;
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
    SELECT EXISTS (
      SELECT 1
      FROM public.memberships AS membership
      WHERE membership.id = NEW.assigned_membership_id
        AND membership.tenant_id = NEW.tenant_id
        AND membership.role = 'technician'
        AND membership.status = 'active'
    )
    INTO assignee_is_active_technician;

    IF NOT assignee_is_active_technician THEN
      RAISE EXCEPTION 'job assignee must be an active technician in the same tenant'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_job_write() FROM PUBLIC;

CREATE FUNCTION public.record_job_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  audit_action text;
  audit_metadata jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    audit_action := 'job.created';
    audit_metadata := jsonb_build_object(
      'status', NEW.status,
      'priority', NEW.priority
    );
  ELSIF NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL THEN
    audit_action := 'job.archived';
    audit_metadata := jsonb_build_object('status', NEW.status);
  ELSIF NEW.status <> OLD.status THEN
    audit_action := 'job.status_changed';
    audit_metadata := jsonb_build_object(
      'from', OLD.status,
      'to', NEW.status
    );
  ELSIF NEW.assigned_membership_id IS DISTINCT FROM OLD.assigned_membership_id
    OR NEW.scheduled_start_at IS DISTINCT FROM OLD.scheduled_start_at
    OR NEW.scheduled_end_at IS DISTINCT FROM OLD.scheduled_end_at THEN
    audit_action := 'job.scheduled';
    audit_metadata := jsonb_build_object(
      'assigned_membership_id', NEW.assigned_membership_id,
      'scheduled_start_at', NEW.scheduled_start_at,
      'scheduled_end_at', NEW.scheduled_end_at
    );
  ELSE
    audit_action := 'job.updated';
    audit_metadata := jsonb_build_object('status', NEW.status);
  END IF;

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
    audit_action,
    'job',
    NEW.id,
    audit_metadata
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.record_job_activity() FROM PUBLIC;

CREATE TRIGGER jobs_validate_write
BEFORE INSERT OR UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.validate_job_write();

CREATE TRIGGER jobs_updated_at
BEFORE UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER jobs_tenant_immutable
BEFORE UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_change();

CREATE TRIGGER jobs_record_activity
AFTER INSERT OR UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.record_job_activity();

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY jobs_read_authorized ON public.jobs
FOR SELECT TO authenticated USING (
  public.current_user_has_tenant_role(
    tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  )
  OR EXISTS (
    SELECT 1
    FROM public.memberships AS membership
    WHERE membership.id = jobs.assigned_membership_id
      AND membership.tenant_id = jobs.tenant_id
      AND membership.user_id = auth.uid()
      AND membership.role = 'technician'
      AND membership.status = 'active'
  )
);

CREATE POLICY jobs_manage_office ON public.jobs
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

CREATE POLICY customers_read_assigned_technician ON public.customers
FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1
    FROM public.jobs AS job
    JOIN public.memberships AS membership
      ON membership.id = job.assigned_membership_id
      AND membership.tenant_id = job.tenant_id
    WHERE job.customer_id = customers.id
      AND job.tenant_id = customers.tenant_id
      AND job.archived_at IS NULL
      AND membership.user_id = auth.uid()
      AND membership.role = 'technician'
      AND membership.status = 'active'
  )
);

CREATE POLICY audit_events_read_assigned_job_technician ON public.audit_events
FOR SELECT TO authenticated USING (
  entity_type = 'job'
  AND EXISTS (
    SELECT 1
    FROM public.jobs AS job
    JOIN public.memberships AS membership
      ON membership.id = job.assigned_membership_id
      AND membership.tenant_id = job.tenant_id
    WHERE job.id = audit_events.entity_id
      AND job.tenant_id = audit_events.tenant_id
      AND job.archived_at IS NULL
      AND membership.user_id = auth.uid()
      AND membership.role = 'technician'
      AND membership.status = 'active'
  )
);

REVOKE ALL ON public.jobs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.jobs TO authenticated;

COMMENT ON TABLE public.jobs IS
  'Tenant-owned service jobs with guarded lifecycle transitions and conflict-safe technician scheduling.';
