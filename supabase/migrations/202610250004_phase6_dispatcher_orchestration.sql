-- CrewFlow Phase 6: authoritative deterministic Dispatcher orchestration.
-- This RPC creates governed proposals and approvals but never mutates a job.

CREATE FUNCTION public.request_dispatcher_proposal(
  target_job_id uuid,
  target_correlation_id uuid
)
RETURNS TABLE (
  run_id uuid,
  approval_id uuid,
  proposal_result text,
  technician_membership_id uuid,
  result_message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  locked_job public.jobs%ROWTYPE;
  actor_membership public.memberships%ROWTYPE;
  tenant_time_zone text;
  customer_postal_code text;
  required_service_skills text[];
  local_start timestamp;
  local_end timestamp;
  workload_window_start timestamptz;
  workload_window_end timestamptz;
  selected_technician_id uuid;
  selected_assignment_count bigint;
  selected_workload_minutes bigint;
  existing_run public.ai_agent_runs%ROWTYPE;
  existing_approval_id uuid;
  new_run_id uuid;
  new_approval_id uuid;
  run_summary text;
  ai_enabled boolean;
  tenant_budget integer;
  plan_budget bigint;
  effective_budget bigint;
  spent_this_month bigint;
  eligible_count integer;
  in_progress_reassignment boolean;
BEGIN
  SELECT job.*
  INTO locked_job
  FROM public.jobs AS job
  WHERE job.id = target_job_id
    AND job.archived_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found or unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT membership.*
  INTO actor_membership
  FROM public.memberships AS membership
  WHERE membership.tenant_id = locked_job.tenant_id
    AND membership.user_id = auth.uid()
    AND membership.status = 'active'
    AND membership.role IN ('owner', 'office');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active office membership required' USING ERRCODE = '42501';
  END IF;

  IF locked_job.status NOT IN ('accepted', 'scheduled', 'in_progress')
    OR locked_job.scheduled_start_at IS NULL
    OR locked_job.scheduled_end_at IS NULL THEN
    RAISE EXCEPTION 'job must be accepted or active with a complete schedule'
      USING ERRCODE = '22023';
  END IF;

  SELECT tenant.time_zone, customer.postal_code,
         coalesce(service.required_skills, '{}')
  INTO tenant_time_zone, customer_postal_code, required_service_skills
  FROM public.customers AS customer
  LEFT JOIN public.services AS service
    ON service.id = locked_job.service_id
    AND service.tenant_id = locked_job.tenant_id
  JOIN public.tenants AS tenant ON tenant.id = locked_job.tenant_id
  WHERE customer.id = locked_job.customer_id
    AND customer.tenant_id = locked_job.tenant_id;

  IF customer_postal_code IS NULL
    OR customer_postal_code !~ '^\d{5}(-\d{4})?$' THEN
    RAISE EXCEPTION 'customer needs a valid US service ZIP code'
      USING ERRCODE = '22023';
  END IF;

  local_start := locked_job.scheduled_start_at AT TIME ZONE tenant_time_zone;
  local_end := locked_job.scheduled_end_at AT TIME ZONE tenant_time_zone;
  IF local_start::date <> local_end::date THEN
    RAISE EXCEPTION 'job schedule must stay within one local day'
      USING ERRCODE = '22023';
  END IF;

  run_summary := concat('Dispatcher evaluation for job ', locked_job.id);

  SELECT run.*
  INTO existing_run
  FROM public.ai_agent_runs AS run
  WHERE run.tenant_id = locked_job.tenant_id
    AND run.correlation_id = target_correlation_id;

  IF FOUND THEN
    IF existing_run.actor_user_id IS DISTINCT FROM auth.uid()
      OR existing_run.agent_kind <> 'dispatcher'
      OR existing_run.policy_version <> 'dispatcher-v1'
      OR existing_run.redacted_input_summary <> run_summary THEN
      RAISE EXCEPTION 'AI correlation payload conflict' USING ERRCODE = '23505';
    END IF;

    SELECT approval.id
    INTO existing_approval_id
    FROM public.ai_approval_requests AS approval
    WHERE approval.run_id = existing_run.id
      AND approval.tenant_id = existing_run.tenant_id
    LIMIT 1;

    RETURN QUERY SELECT
      existing_run.id,
      existing_approval_id,
      CASE
        WHEN existing_approval_id IS NOT NULL THEN 'proposed'
        WHEN existing_run.status = 'escalated' THEN 'escalated'
        ELSE 'unchanged'
      END,
      NULL::uuid,
      'Existing Dispatcher evaluation returned.'::text;
    RETURN;
  END IF;

  SELECT settings.ai_operations_enabled, settings.ai_monthly_budget_cents
  INTO ai_enabled, tenant_budget
  FROM public.tenant_settings AS settings
  WHERE settings.tenant_id = locked_job.tenant_id;

  IF NOT coalesce(ai_enabled, false) THEN
    RAISE EXCEPTION 'AI operations are disabled' USING ERRCODE = '42501';
  END IF;

  SELECT plan.ai_monthly_budget_cents
  INTO plan_budget
  FROM public.tenant_subscriptions AS subscription
  JOIN public.billing_plans AS plan ON plan.code = subscription.plan_code
  WHERE subscription.tenant_id = locked_job.tenant_id;

  effective_budget := CASE
    WHEN plan_budget IS NULL THEN tenant_budget
    ELSE least(tenant_budget::bigint, plan_budget)
  END;

  SELECT coalesce(sum(run.estimated_cost_cents), 0)
  INTO spent_this_month
  FROM public.ai_agent_runs AS run
  WHERE run.tenant_id = locked_job.tenant_id
    AND run.created_at >= date_trunc('month', now());

  IF effective_budget <= spent_this_month THEN
    RAISE EXCEPTION 'AI monthly budget exhausted' USING ERRCODE = 'P0001';
  END IF;

  workload_window_start :=
    date_trunc('week', local_start) AT TIME ZONE tenant_time_zone;
  workload_window_end :=
    (date_trunc('week', local_start) + interval '7 days')
      AT TIME ZONE tenant_time_zone;

  WITH eligible AS (
    SELECT
      membership.id,
      count(workload_job.id) AS assignment_count,
      coalesce(sum(
        extract(epoch FROM (
          workload_job.scheduled_end_at - workload_job.scheduled_start_at
        )) / 60
      ), 0)::bigint AS workload_minutes
    FROM public.memberships AS membership
    JOIN public.staff_profiles AS profile
      ON profile.membership_id = membership.id
      AND profile.tenant_id = membership.tenant_id
    JOIN public.staff_availability AS availability
      ON availability.membership_id = membership.id
      AND availability.tenant_id = membership.tenant_id
    LEFT JOIN public.jobs AS workload_job
      ON workload_job.assigned_membership_id = membership.id
      AND workload_job.tenant_id = membership.tenant_id
      AND workload_job.id <> locked_job.id
      AND workload_job.archived_at IS NULL
      AND workload_job.status IN ('scheduled', 'in_progress')
      AND workload_job.scheduled_start_at < workload_window_end
      AND workload_job.scheduled_end_at > workload_window_start
    WHERE membership.tenant_id = locked_job.tenant_id
      AND membership.role = 'technician'
      AND membership.status = 'active'
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
    GROUP BY membership.id
  )
  SELECT eligible.id, eligible.assignment_count, eligible.workload_minutes,
         count(*) OVER ()::integer
  INTO selected_technician_id, selected_assignment_count,
       selected_workload_minutes, eligible_count
  FROM eligible
  ORDER BY eligible.workload_minutes, eligible.assignment_count, eligible.id
  LIMIT 1;

  IF selected_technician_id IS NULL THEN
    INSERT INTO public.ai_agent_runs (
      tenant_id, actor_user_id, agent_kind, policy_version, correlation_id,
      status, redacted_input_summary, completed_at
    ) VALUES (
      locked_job.tenant_id, auth.uid(), 'dispatcher', 'dispatcher-v1',
      target_correlation_id, 'escalated', run_summary, now()
    ) RETURNING id INTO new_run_id;

    INSERT INTO public.ai_run_steps (
      tenant_id, run_id, sequence_number, step_kind, redacted_summary,
      outcome, duration_ms
    ) VALUES (
      locked_job.tenant_id, new_run_id, 1, 'candidate_evaluation',
      'No technician satisfied skills, service area, weekly availability, time-off, and conflict checks.',
      'escalated', 0
    );

    INSERT INTO public.audit_events (
      tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
      locked_job.tenant_id, auth.uid(), 'ai.dispatcher_escalated',
      'job', locked_job.id, jsonb_build_object('run_id', new_run_id)
    );

    RETURN QUERY SELECT
      new_run_id, NULL::uuid, 'escalated'::text, NULL::uuid,
      'No eligible technician was found. Review skills, service area, availability, time off, and conflicts.'::text;
    RETURN;
  END IF;

  INSERT INTO public.ai_agent_runs (
    tenant_id, actor_user_id, agent_kind, policy_version, correlation_id,
    status, redacted_input_summary, completed_at
  ) VALUES (
    locked_job.tenant_id, auth.uid(), 'dispatcher', 'dispatcher-v1',
    target_correlation_id, 'succeeded', run_summary, now()
  ) RETURNING id INTO new_run_id;

  INSERT INTO public.ai_run_steps (
    tenant_id, run_id, sequence_number, step_kind, redacted_summary,
    outcome, duration_ms
  ) VALUES (
    locked_job.tenant_id, new_run_id, 1, 'candidate_evaluation',
    format(
      '%s eligible technicians; selected lowest workload (%s assignments / %s minutes).',
      eligible_count, selected_assignment_count, selected_workload_minutes
    ),
    'grounded', 0
  );

  IF locked_job.assigned_membership_id = selected_technician_id THEN
    INSERT INTO public.audit_events (
      tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
      locked_job.tenant_id, auth.uid(), 'ai.dispatcher_unchanged',
      'job', locked_job.id,
      jsonb_build_object('run_id', new_run_id)
    );

    RETURN QUERY SELECT
      new_run_id, NULL::uuid, 'unchanged'::text, selected_technician_id,
      'The best eligible technician is already assigned.'::text;
    RETURN;
  END IF;

  SELECT approval.id
  INTO existing_approval_id
  FROM public.ai_approval_requests AS approval
  WHERE approval.tenant_id = locked_job.tenant_id
    AND approval.action_kind = 'dispatcher.assign_technician'
    AND approval.target_entity_type = 'job'
    AND approval.target_entity_id = locked_job.id
    AND approval.status = 'pending'
    AND approval.expires_at > now()
  ORDER BY approval.created_at DESC
  LIMIT 1;

  IF existing_approval_id IS NOT NULL THEN
    RETURN QUERY SELECT
      new_run_id, existing_approval_id, 'proposed'::text,
      selected_technician_id,
      'A current Dispatcher approval already exists for this job.'::text;
    RETURN;
  END IF;

  in_progress_reassignment := locked_job.status = 'in_progress'
    AND locked_job.assigned_membership_id IS NOT NULL;

  INSERT INTO public.ai_approval_requests (
    tenant_id, run_id, action_kind, rationale, proposed_changes,
    consequences, target_entity_type, target_entity_id,
    target_state_version, requested_by_user_id
  ) VALUES (
    locked_job.tenant_id,
    new_run_id,
    'dispatcher.assign_technician',
    format(
      'Selected from %s eligible technicians using skills, service area, availability, conflicts, and lowest weekly workload (%s assignments / %s minutes).',
      eligible_count, selected_assignment_count, selected_workload_minutes
    ),
    jsonb_build_object(
      'assignedMembershipId', jsonb_build_object(
        'from', locked_job.assigned_membership_id,
        'to', selected_technician_id
      )
    ),
    CASE WHEN in_progress_reassignment THEN
      'This would reassign work already in progress. Approval is mandatory, and execution must revalidate the current assignee and job state.'
    ELSE
      'This would change the assigned technician. Execution must revalidate job state, availability, time off, skills, service area, and conflicts.'
    END,
    'job',
    locked_job.id,
    locked_job.updated_at::text,
    auth.uid()
  ) RETURNING id INTO new_approval_id;

  INSERT INTO public.ai_run_steps (
    tenant_id, run_id, sequence_number, step_kind, tool_name,
    redacted_summary, outcome, duration_ms
  ) VALUES (
    locked_job.tenant_id, new_run_id, 2, 'approval_requested',
    'dispatcher.assign_technician',
    CASE WHEN in_progress_reassignment
      THEN 'Created mandatory human approval for in-progress reassignment.'
      ELSE 'Created human approval before assignment mutation.'
    END,
    'pending_approval', 0
  );

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    locked_job.tenant_id, auth.uid(), 'ai.dispatcher_proposed',
    'job', locked_job.id,
    jsonb_build_object(
      'run_id', new_run_id,
      'approval_id', new_approval_id,
      'in_progress_reassignment', in_progress_reassignment
    )
  );

  RETURN QUERY SELECT
    new_run_id, new_approval_id, 'proposed'::text,
    selected_technician_id,
    'Dispatcher proposal created for human review.'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.request_dispatcher_proposal(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_dispatcher_proposal(uuid, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.request_dispatcher_proposal(uuid, uuid) IS
  'Creates a tenant-authorized deterministic Dispatcher run and optional approval; never mutates jobs.';
