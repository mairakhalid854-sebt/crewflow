-- CrewFlow Phase 6: guarded execution for approved Dispatcher assignments.
-- Expected stale/policy failures are recorded without mutating the job.

ALTER TABLE public.ai_approval_requests
  ADD COLUMN execution_status text,
  ADD COLUMN executed_at timestamptz,
  ADD COLUMN executed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN execution_message text,
  ADD CONSTRAINT ai_approval_requests_execution_shape CHECK (
    (
      execution_status IS NULL
      AND executed_at IS NULL
      AND executed_by_user_id IS NULL
      AND execution_message IS NULL
    ) OR (
      execution_status IN ('succeeded', 'rejected_stale', 'rejected_policy')
      AND executed_at IS NOT NULL
      AND executed_by_user_id IS NOT NULL
      AND char_length(execution_message) BETWEEN 3 AND 1000
      AND status = 'approved'
    )
  );

CREATE FUNCTION public.execute_approved_dispatcher_assignment(
  target_approval_id uuid
)
RETURNS TABLE (
  execution_result text,
  job_id uuid,
  technician_membership_id uuid,
  result_message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  approval public.ai_approval_requests%ROWTYPE;
  locked_job public.jobs%ROWTYPE;
  proposed_technician_id uuid;
  tenant_time_zone text;
  customer_postal_code text;
  required_service_skills text[];
  local_start timestamp;
  local_end timestamp;
  candidate_is_eligible boolean;
  next_step_number integer;
  rejection_message text;
BEGIN
  SELECT request.*
  INTO approval
  FROM public.ai_approval_requests AS request
  WHERE request.id = target_approval_id
  FOR UPDATE;

  IF approval.id IS NULL OR NOT public.current_user_has_tenant_role(
    approval.tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'approval not found or unavailable' USING ERRCODE = '42501';
  END IF;

  IF approval.action_kind <> 'dispatcher.assign_technician'
    OR approval.target_entity_type <> 'job'
    OR approval.target_entity_id IS NULL THEN
    RAISE EXCEPTION 'approval is not a Dispatcher assignment'
      USING ERRCODE = '22023';
  END IF;

  IF approval.status <> 'approved' THEN
    RAISE EXCEPTION 'Dispatcher assignment requires an approved request'
      USING ERRCODE = 'P0001';
  END IF;

  IF approval.execution_status IS NOT NULL THEN
    RETURN QUERY SELECT
      approval.execution_status,
      approval.target_entity_id,
      CASE WHEN approval.execution_status = 'succeeded'
        THEN nullif(
          approval.proposed_changes #>> '{assignedMembershipId,to}', ''
        )::uuid
        ELSE NULL::uuid
      END,
      approval.execution_message;
    RETURN;
  END IF;

  IF coalesce(
    approval.proposed_changes #>> '{assignedMembershipId,to}', ''
  ) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Dispatcher proposal has an invalid technician identifier'
      USING ERRCODE = '22023';
  END IF;
  proposed_technician_id := (
    approval.proposed_changes #>> '{assignedMembershipId,to}'
  )::uuid;

  SELECT job.*
  INTO locked_job
  FROM public.jobs AS job
  WHERE job.id = approval.target_entity_id
    AND job.tenant_id = approval.tenant_id
  FOR UPDATE;

  IF locked_job.id IS NULL
    OR locked_job.archived_at IS NOT NULL
    OR locked_job.updated_at::text IS DISTINCT FROM approval.target_state_version
    OR locked_job.status NOT IN ('accepted', 'scheduled', 'in_progress')
    OR locked_job.scheduled_start_at IS NULL
    OR locked_job.scheduled_end_at IS NULL THEN
    rejection_message :=
      'Job state changed after approval was requested. Create a fresh Dispatcher proposal.';

    UPDATE public.ai_approval_requests
    SET execution_status = 'rejected_stale',
        executed_at = now(),
        executed_by_user_id = auth.uid(),
        execution_message = rejection_message
    WHERE id = approval.id;

    SELECT coalesce(max(step.sequence_number), 0) + 1
    INTO next_step_number
    FROM public.ai_run_steps AS step
    WHERE step.run_id = approval.run_id;

    INSERT INTO public.ai_run_steps (
      tenant_id, run_id, sequence_number, step_kind, tool_name,
      redacted_summary, outcome, duration_ms
    ) VALUES (
      approval.tenant_id, approval.run_id, next_step_number,
      'guarded_execution', 'dispatcher.assign_technician',
      rejection_message, 'rejected_stale', 0
    );

    INSERT INTO public.audit_events (
      tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
      approval.tenant_id, auth.uid(), 'ai.dispatcher_execution_rejected',
      'job', approval.target_entity_id,
      jsonb_build_object(
        'approval_id', approval.id,
        'run_id', approval.run_id,
        'reason', 'stale_state'
      )
    );

    RETURN QUERY SELECT
      'rejected_stale'::text, approval.target_entity_id, NULL::uuid,
      rejection_message;
    RETURN;
  END IF;

  SELECT tenant.time_zone, customer.postal_code,
         coalesce(service.required_skills, '{}')
  INTO tenant_time_zone, customer_postal_code, required_service_skills
  FROM public.customers AS customer
  JOIN public.tenants AS tenant ON tenant.id = locked_job.tenant_id
  LEFT JOIN public.services AS service
    ON service.id = locked_job.service_id
    AND service.tenant_id = locked_job.tenant_id
  WHERE customer.id = locked_job.customer_id
    AND customer.tenant_id = locked_job.tenant_id;

  local_start := locked_job.scheduled_start_at AT TIME ZONE tenant_time_zone;
  local_end := locked_job.scheduled_end_at AT TIME ZONE tenant_time_zone;

  SELECT EXISTS (
    SELECT 1
    FROM public.memberships AS membership
    JOIN public.staff_profiles AS profile
      ON profile.membership_id = membership.id
      AND profile.tenant_id = membership.tenant_id
    JOIN public.staff_availability AS availability
      ON availability.membership_id = membership.id
      AND availability.tenant_id = membership.tenant_id
    JOIN public.tenant_subscriptions AS subscription
      ON subscription.tenant_id = membership.tenant_id
    WHERE membership.id = proposed_technician_id
      AND membership.tenant_id = approval.tenant_id
      AND membership.role = 'technician'
      AND membership.status = 'active'
      AND subscription.access_mode = 'full'
      AND customer_postal_code ~ '^\d{5}(-\d{4})?$'
      AND customer_postal_code = ANY (profile.service_area_postal_codes)
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(required_service_skills) AS required_skill
        WHERE NOT EXISTS (
          SELECT 1
          FROM unnest(profile.skills) AS staff_skill
          WHERE lower(trim(staff_skill)) = lower(trim(required_skill))
        )
      )
      AND local_start::date = local_end::date
      AND availability.day_of_week = extract(dow FROM local_start)::smallint
      AND availability.is_available
      AND availability.starts_at <= local_start::time
      AND availability.ends_at >= local_end::time
      AND NOT EXISTS (
        SELECT 1
        FROM public.staff_time_off AS time_off
        WHERE time_off.tenant_id = membership.tenant_id
          AND time_off.membership_id = membership.id
          AND time_off.cancelled_at IS NULL
          AND time_off.starts_at < locked_job.scheduled_end_at
          AND time_off.ends_at > locked_job.scheduled_start_at
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.jobs AS conflict
        WHERE conflict.tenant_id = membership.tenant_id
          AND conflict.assigned_membership_id = membership.id
          AND conflict.id <> locked_job.id
          AND conflict.archived_at IS NULL
          AND conflict.status IN ('scheduled', 'in_progress')
          AND conflict.scheduled_start_at < locked_job.scheduled_end_at
          AND conflict.scheduled_end_at > locked_job.scheduled_start_at
      )
  ) INTO candidate_is_eligible;

  IF NOT candidate_is_eligible THEN
    rejection_message :=
      'Technician eligibility changed. Create a fresh Dispatcher proposal.';

    UPDATE public.ai_approval_requests
    SET execution_status = 'rejected_policy',
        executed_at = now(),
        executed_by_user_id = auth.uid(),
        execution_message = rejection_message
    WHERE id = approval.id;

    SELECT coalesce(max(step.sequence_number), 0) + 1
    INTO next_step_number
    FROM public.ai_run_steps AS step
    WHERE step.run_id = approval.run_id;

    INSERT INTO public.ai_run_steps (
      tenant_id, run_id, sequence_number, step_kind, tool_name,
      redacted_summary, outcome, duration_ms
    ) VALUES (
      approval.tenant_id, approval.run_id, next_step_number,
      'guarded_execution', 'dispatcher.assign_technician',
      rejection_message, 'rejected_policy', 0
    );

    INSERT INTO public.audit_events (
      tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
      approval.tenant_id, auth.uid(), 'ai.dispatcher_execution_rejected',
      'job', locked_job.id,
      jsonb_build_object(
        'approval_id', approval.id,
        'run_id', approval.run_id,
        'reason', 'policy_changed'
      )
    );

    RETURN QUERY SELECT
      'rejected_policy'::text, locked_job.id, NULL::uuid, rejection_message;
    RETURN;
  END IF;

  UPDATE public.jobs
  SET assigned_membership_id = proposed_technician_id
  WHERE id = locked_job.id;

  UPDATE public.ai_approval_requests
  SET execution_status = 'succeeded',
      executed_at = now(),
      executed_by_user_id = auth.uid(),
      execution_message = 'Approved technician assignment was applied after current-state and policy revalidation.'
  WHERE id = approval.id;

  SELECT coalesce(max(step.sequence_number), 0) + 1
  INTO next_step_number
  FROM public.ai_run_steps AS step
  WHERE step.run_id = approval.run_id;

  INSERT INTO public.ai_run_steps (
    tenant_id, run_id, sequence_number, step_kind, tool_name,
    redacted_summary, outcome, duration_ms
  ) VALUES (
    approval.tenant_id, approval.run_id, next_step_number,
    'guarded_execution', 'dispatcher.assign_technician',
    'Approved technician assignment applied after role, state, subscription, skills, service area, availability, time-off, and conflict checks.',
    'succeeded', 0
  );

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    approval.tenant_id, auth.uid(), 'ai.dispatcher_executed',
    'job', locked_job.id,
    jsonb_build_object(
      'approval_id', approval.id,
      'run_id', approval.run_id,
      'technician_membership_id', proposed_technician_id
    )
  );

  RETURN QUERY SELECT
    'succeeded'::text, locked_job.id, proposed_technician_id,
    'Approved technician assignment applied.'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_approved_dispatcher_assignment(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_approved_dispatcher_assignment(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.execute_approved_dispatcher_assignment(uuid) IS
  'Idempotently executes an approved Dispatcher assignment only after current role, target state, subscription, and eligibility revalidation.';
