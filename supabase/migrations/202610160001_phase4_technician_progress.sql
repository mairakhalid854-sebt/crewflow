-- CrewFlow Phase 4: assigned technicians can advance their own scheduled work
-- and append immutable field notes without receiving broad job update access.

CREATE TABLE public.job_work_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL,
  author_membership_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_work_notes_job_tenant_fk
    FOREIGN KEY (job_id, tenant_id)
    REFERENCES public.jobs(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT job_work_notes_author_tenant_fk
    FOREIGN KEY (author_membership_id, tenant_id)
    REFERENCES public.memberships(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT job_work_notes_body_length CHECK (
    char_length(trim(body)) BETWEEN 3 AND 2000
  )
);

CREATE INDEX job_work_notes_job_time_idx
  ON public.job_work_notes (job_id, created_at DESC);
CREATE INDEX job_work_notes_tenant_time_idx
  ON public.job_work_notes (tenant_id, created_at DESC);

ALTER TABLE public.job_work_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY job_work_notes_read_authorized ON public.job_work_notes
FOR SELECT TO authenticated USING (
  public.current_user_has_tenant_role(
    tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  )
  OR EXISTS (
    SELECT 1
    FROM public.jobs AS job
    JOIN public.memberships AS membership
      ON membership.id = job.assigned_membership_id
      AND membership.tenant_id = job.tenant_id
    WHERE job.id = job_work_notes.job_id
      AND job.tenant_id = job_work_notes.tenant_id
      AND job.archived_at IS NULL
      AND membership.user_id = auth.uid()
      AND membership.role = 'technician'
      AND membership.status = 'active'
  )
);

CREATE FUNCTION public.advance_assigned_job(
  target_job_id uuid,
  target_status public.job_status,
  work_note text DEFAULT ''
)
RETURNS public.job_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  locked_job public.jobs%ROWTYPE;
  normalized_note text := trim(coalesce(work_note, ''));
  technician_membership_id uuid;
  work_note_id uuid;
BEGIN
  IF target_status NOT IN ('in_progress', 'completed') THEN
    RAISE EXCEPTION 'technicians may only start or complete assigned jobs'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(normalized_note) > 2000 THEN
    RAISE EXCEPTION 'work note cannot exceed 2000 characters'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(normalized_note) BETWEEN 1 AND 2 THEN
    RAISE EXCEPTION 'work note must be at least 3 characters or empty'
      USING ERRCODE = '22023';
  END IF;

  IF target_status = 'completed' AND char_length(normalized_note) < 3 THEN
    RAISE EXCEPTION 'a completion note is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT job.*
  INTO locked_job
  FROM public.jobs AS job
  WHERE job.id = target_job_id
  FOR UPDATE;

  IF NOT FOUND OR locked_job.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'assigned job not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT membership.id
  INTO technician_membership_id
  FROM public.memberships AS membership
  WHERE membership.id = locked_job.assigned_membership_id
    AND membership.tenant_id = locked_job.tenant_id
    AND membership.user_id = auth.uid()
    AND membership.role = 'technician'
    AND membership.status = 'active';

  IF technician_membership_id IS NULL THEN
    RAISE EXCEPTION 'only the assigned active technician may update this job'
      USING ERRCODE = '42501';
  END IF;

  IF NOT (
    (locked_job.status = 'scheduled' AND target_status = 'in_progress')
    OR (locked_job.status = 'in_progress' AND target_status = 'completed')
  ) THEN
    RAISE EXCEPTION 'invalid technician job transition from % to %',
      locked_job.status,
      target_status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.jobs
  SET status = target_status
  WHERE id = locked_job.id;

  IF char_length(normalized_note) >= 3 THEN
    INSERT INTO public.job_work_notes (
      tenant_id,
      job_id,
      author_membership_id,
      body
    )
    VALUES (
      locked_job.tenant_id,
      locked_job.id,
      technician_membership_id,
      normalized_note
    )
    RETURNING id INTO work_note_id;

    INSERT INTO public.audit_events (
      tenant_id,
      actor_user_id,
      action,
      entity_type,
      entity_id,
      metadata
    )
    VALUES (
      locked_job.tenant_id,
      auth.uid(),
      'job.work_note_added',
      'job',
      locked_job.id,
      jsonb_build_object('work_note_id', work_note_id)
    );
  END IF;

  RETURN target_status;
END;
$$;

REVOKE ALL ON public.job_work_notes FROM anon, authenticated;
GRANT SELECT ON public.job_work_notes TO authenticated;

REVOKE ALL ON FUNCTION public.advance_assigned_job(uuid, public.job_status, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.advance_assigned_job(uuid, public.job_status, text)
  TO authenticated;

COMMENT ON TABLE public.job_work_notes IS
  'Immutable technician field notes scoped to an assigned tenant job.';
COMMENT ON FUNCTION public.advance_assigned_job(uuid, public.job_status, text) IS
  'Atomically starts or completes a job for its assigned active technician and optionally records a field note.';
