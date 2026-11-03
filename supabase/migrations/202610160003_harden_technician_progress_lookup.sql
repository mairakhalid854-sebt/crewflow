-- Avoid revealing whether an arbitrary job UUID exists. The locked job lookup
-- now succeeds only when the caller is its assigned active technician.

CREATE OR REPLACE FUNCTION public.advance_assigned_job(
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
  work_note_id uuid;
BEGIN
  IF target_status NOT IN ('in_progress', 'completed') THEN
    RAISE EXCEPTION 'technicians may only start or complete assigned jobs'
      USING ERRCODE = '22023';
  END IF;

  SELECT job.*
  INTO locked_job
  FROM public.jobs AS job
  JOIN public.memberships AS membership
    ON membership.id = job.assigned_membership_id
    AND membership.tenant_id = job.tenant_id
  WHERE job.id = target_job_id
    AND job.archived_at IS NULL
    AND membership.user_id = auth.uid()
    AND membership.role = 'technician'
    AND membership.status = 'active'
  FOR UPDATE OF job;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'assigned job not found or unavailable'
      USING ERRCODE = '42501';
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
      locked_job.assigned_membership_id,
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

REVOKE EXECUTE ON FUNCTION public.advance_assigned_job(
  uuid,
  public.job_status,
  text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.advance_assigned_job(
  uuid,
  public.job_status,
  text
) TO authenticated;
