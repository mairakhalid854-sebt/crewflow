-- CrewFlow Phase 6: authoritative Intake quote and two-slot proposals.
-- This function creates governed evidence and approval only; no business row is created.

CREATE FUNCTION public.request_intake_quote_slot_proposal(
  target_conversation_id uuid,
  target_correlation_id uuid
)
RETURNS TABLE (
  run_id uuid,
  approval_id uuid,
  proposal_result text,
  result_message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  conversation public.intake_conversations%ROWTYPE;
  service public.services%ROWTYPE;
  actor public.memberships%ROWTYPE;
  tenant_zone text;
  tenant_tax integer;
  ai_enabled boolean;
  tenant_budget integer;
  plan_budget bigint;
  tenant_access public.billing_access_mode;
  spent bigint;
  effective_budget bigint;
  customer_name text;
  contact_kind text;
  contact_value text;
  address_value text;
  problem_value text;
  postal_value text;
  local_today date;
  slot_options jsonb;
  slot_count integer;
  subtotal integer;
  tax_cents integer;
  total integer;
  proposed jsonb;
  state_version text;
  summary text;
  existing_run public.ai_agent_runs%ROWTYPE;
  existing_approval uuid;
  existing_approval_run uuid;
  new_run uuid;
  new_approval uuid;
BEGIN
  SELECT item.* INTO conversation
  FROM public.intake_conversations AS item
  WHERE item.id = target_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Intake conversation not found' USING ERRCODE = '42501';
  END IF;

  SELECT membership.* INTO actor
  FROM public.memberships AS membership
  WHERE membership.tenant_id = conversation.tenant_id
    AND membership.user_id = auth.uid()
    AND membership.status = 'active'
    AND membership.role IN ('owner', 'office');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active office membership required' USING ERRCODE = '42501';
  END IF;

  IF conversation.status <> 'ready_for_human_review'
    OR conversation.stage <> 'complete'
    OR conversation.selected_service_id IS NULL THEN
    RAISE EXCEPTION 'Intake conversation is not ready for a quote proposal'
      USING ERRCODE = '22023';
  END IF;

  SELECT item.* INTO service
  FROM public.services AS item
  WHERE item.id = conversation.selected_service_id
    AND item.tenant_id = conversation.tenant_id
    AND item.is_enabled
    AND item.archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirmed catalog service is unavailable' USING ERRCODE = '22023';
  END IF;

  SELECT tenant.time_zone, tenant.tax_rate_bps
  INTO tenant_zone, tenant_tax
  FROM public.tenants AS tenant WHERE tenant.id = conversation.tenant_id;

  customer_name := trim(conversation.collected_values ->> 'customerName');
  contact_kind := trim(conversation.collected_values #>> '{contact,kind}');
  contact_value := trim(conversation.collected_values #>> '{contact,value}');
  address_value := trim(conversation.collected_values ->> 'address');
  problem_value := trim(conversation.collected_values ->> 'problem');
  postal_value := coalesce(
    substring(address_value FROM '[0-9]{5}-[0-9]{4}'),
    substring(address_value FROM '[0-9]{5}')
  );

  IF char_length(customer_name) NOT BETWEEN 2 AND 120
    OR char_length(address_value) NOT BETWEEN 10 AND 300
    OR char_length(problem_value) NOT BETWEEN 10 AND 2000
    OR postal_value IS NULL
    OR (contact_kind = 'email'
      AND contact_value !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
    OR (contact_kind = 'phone' AND contact_value !~ '^\+1[0-9]{10}$')
    OR contact_kind NOT IN ('email', 'phone') THEN
    RAISE EXCEPTION 'validated Intake details are incomplete' USING ERRCODE = '22023';
  END IF;

  summary := concat('Intake quote and slot evaluation for conversation ', conversation.id);
  SELECT run.* INTO existing_run
  FROM public.ai_agent_runs AS run
  WHERE run.tenant_id = conversation.tenant_id
    AND run.correlation_id = target_correlation_id;
  IF FOUND THEN
    IF existing_run.actor_user_id IS DISTINCT FROM auth.uid()
      OR existing_run.agent_kind <> 'intake'
      OR existing_run.policy_version <> 'intake-quote-slots-v1'
      OR existing_run.redacted_input_summary <> summary THEN
      RAISE EXCEPTION 'AI correlation payload conflict' USING ERRCODE = '23505';
    END IF;
    SELECT request.id INTO existing_approval
    FROM public.ai_approval_requests AS request
    WHERE request.run_id = existing_run.id LIMIT 1;
    RETURN QUERY SELECT existing_run.id, existing_approval,
      CASE WHEN existing_approval IS NULL THEN 'escalated' ELSE 'proposed' END,
      'Existing Intake evaluation returned.'::text;
    RETURN;
  END IF;

  SELECT settings.ai_operations_enabled, settings.ai_monthly_budget_cents
  INTO ai_enabled, tenant_budget
  FROM public.tenant_settings AS settings
  WHERE settings.tenant_id = conversation.tenant_id;
  IF NOT coalesce(ai_enabled, false) THEN
    RAISE EXCEPTION 'AI operations are disabled' USING ERRCODE = '42501';
  END IF;
  SELECT plan.ai_monthly_budget_cents, subscription.access_mode
  INTO plan_budget, tenant_access
  FROM public.tenant_subscriptions AS subscription
  JOIN public.billing_plans AS plan ON plan.code = subscription.plan_code
  WHERE subscription.tenant_id = conversation.tenant_id;
  IF tenant_access IS DISTINCT FROM 'full'::public.billing_access_mode THEN
    RAISE EXCEPTION 'full subscription access required' USING ERRCODE = '42501';
  END IF;
  effective_budget := CASE WHEN plan_budget IS NULL THEN tenant_budget
    ELSE least(tenant_budget::bigint, plan_budget) END;
  SELECT coalesce(sum(run.estimated_cost_cents), 0) INTO spent
  FROM public.ai_agent_runs AS run
  WHERE run.tenant_id = conversation.tenant_id
    AND run.created_at >= date_trunc('month', now());
  IF effective_budget <= spent THEN
    RAISE EXCEPTION 'AI monthly budget exhausted' USING ERRCODE = 'P0001';
  END IF;

  local_today := (now() AT TIME ZONE tenant_zone)::date;
  WITH candidate_slots AS (
    SELECT
      membership.id AS technician_id,
      ((local_today + day_offset.value) + availability.starts_at)
        AT TIME ZONE tenant_zone AS starts_at,
      (((local_today + day_offset.value) + availability.starts_at)
        AT TIME ZONE tenant_zone)
        + make_interval(mins => service.default_duration_minutes) AS ends_at
    FROM generate_series(1, 14) AS day_offset(value)
    JOIN public.memberships AS membership
      ON membership.tenant_id = conversation.tenant_id
      AND membership.role = 'technician' AND membership.status = 'active'
    JOIN public.staff_profiles AS profile
      ON profile.membership_id = membership.id
      AND profile.tenant_id = membership.tenant_id
    JOIN public.staff_availability AS availability
      ON availability.membership_id = membership.id
      AND availability.tenant_id = membership.tenant_id
      AND availability.day_of_week = extract(dow FROM local_today + day_offset.value)::smallint
      AND availability.is_available
    WHERE postal_value = ANY(profile.service_area_postal_codes)
      AND NOT EXISTS (
        SELECT 1 FROM unnest(service.required_skills) AS required_skill
        WHERE NOT EXISTS (
          SELECT 1 FROM unnest(profile.skills) AS staff_skill
          WHERE lower(trim(staff_skill)) = lower(trim(required_skill))
        )
      )
      AND availability.starts_at + make_interval(mins => service.default_duration_minutes)
        <= availability.ends_at
  ), eligible_slots AS (
    SELECT candidate.*
    FROM candidate_slots AS candidate
    WHERE NOT EXISTS (
      SELECT 1 FROM public.staff_time_off AS time_off
      WHERE time_off.tenant_id = conversation.tenant_id
        AND time_off.membership_id = candidate.technician_id
        AND time_off.cancelled_at IS NULL
        AND time_off.starts_at < candidate.ends_at
        AND time_off.ends_at > candidate.starts_at
    ) AND NOT EXISTS (
      SELECT 1 FROM public.jobs AS job
      WHERE job.tenant_id = conversation.tenant_id
        AND job.assigned_membership_id = candidate.technician_id
        AND job.archived_at IS NULL
        AND job.status IN ('scheduled', 'in_progress')
        AND job.scheduled_start_at < candidate.ends_at
        AND job.scheduled_end_at > candidate.starts_at
    )
  ), ranked AS (
    SELECT DISTINCT ON (eligible.starts_at)
      eligible.technician_id, eligible.starts_at, eligible.ends_at
    FROM eligible_slots AS eligible
    ORDER BY eligible.starts_at, eligible.technician_id
    LIMIT 2
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'startsAt', ranked.starts_at,
      'endsAt', ranked.ends_at,
      'technicianMembershipId', ranked.technician_id
    ) ORDER BY ranked.starts_at), '[]'::jsonb), count(*)::integer
  INTO slot_options, slot_count FROM ranked;

  IF slot_count < 2 THEN
    INSERT INTO public.ai_agent_runs (
      tenant_id, actor_user_id, agent_kind, policy_version, correlation_id,
      status, redacted_input_summary, completed_at
    ) VALUES (
      conversation.tenant_id, auth.uid(), 'intake', 'intake-quote-slots-v1',
      target_correlation_id, 'escalated', summary, now()
    ) RETURNING id INTO new_run;
    INSERT INTO public.ai_run_steps (
      tenant_id, run_id, sequence_number, step_kind, redacted_summary, outcome
    ) VALUES (
      conversation.tenant_id, new_run, 1, 'slot_evaluation',
      'Fewer than two technician slots passed trusted availability checks.', 'escalated'
    );
    INSERT INTO public.audit_events (
      tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
      conversation.tenant_id, auth.uid(), 'ai.intake_quote_slots_escalated',
      'intake_conversation', conversation.id,
      jsonb_build_object('run_id', new_run, 'verified_slot_count', slot_count)
    );
    RETURN QUERY SELECT new_run, NULL::uuid, 'escalated'::text,
      'Two verified slots are unavailable; schedule manually.'::text;
    RETURN;
  END IF;

  subtotal := service.unit_price_cents;
  tax_cents := CASE WHEN service.tax_behavior = 'non_taxable' THEN 0
    ELSE round(subtotal::numeric * tenant_tax / 10000)::integer END;
  total := subtotal + tax_cents;
  proposed := jsonb_build_object(
    'customer', jsonb_build_object(
      'name', customer_name, 'contactKind', contact_kind,
      'contactValue', contact_value, 'address', address_value, 'postalCode', postal_value
    ),
    'job', jsonb_build_object(
      'title', service.name, 'description', problem_value, 'serviceId', service.id
    ),
    'quote', jsonb_build_object(
      'description', service.name, 'quantity', 1,
      'unitPriceCents', service.unit_price_cents,
      'taxable', service.tax_behavior <> 'non_taxable',
      'subtotalCents', subtotal, 'taxRateBps', tenant_tax,
      'taxCents', tax_cents, 'totalCents', total
    ),
    'slotOptions', slot_options
  );
  state_version := encode(extensions.digest(convert_to(concat_ws('|',
    conversation.id, conversation.version, service.id, service.updated_at,
    service.unit_price_cents, tenant_tax, proposed::text
  ), 'UTF8'), 'sha256'), 'hex');

  SELECT request.id, request.run_id
  INTO existing_approval, existing_approval_run
  FROM public.ai_approval_requests AS request
  WHERE request.tenant_id = conversation.tenant_id
    AND request.action_kind = 'intake.create_draft_records'
    AND request.target_entity_type = 'intake_conversation'
    AND request.target_entity_id = conversation.id
    AND request.target_state_version = state_version
    AND request.status = 'pending'
    AND request.expires_at > now()
  ORDER BY request.created_at DESC
  LIMIT 1;

  IF existing_approval IS NOT NULL THEN
    RETURN QUERY SELECT existing_approval_run, existing_approval,
      'proposed'::text,
      'An identical Intake proposal already awaits office approval.'::text;
    RETURN;
  END IF;

  INSERT INTO public.ai_agent_runs (
    tenant_id, actor_user_id, agent_kind, policy_version, correlation_id,
    status, redacted_input_summary, completed_at
  ) VALUES (
    conversation.tenant_id, auth.uid(), 'intake', 'intake-quote-slots-v1',
    target_correlation_id, 'succeeded', summary, now()
  ) RETURNING id INTO new_run;
  INSERT INTO public.ai_run_steps (
    tenant_id, run_id, sequence_number, step_kind, redacted_summary, outcome
  ) VALUES (
    conversation.tenant_id, new_run, 1, 'grounded_proposal',
    'Validated Intake details, current catalog price, and two conflict-free technician slots.',
    'grounded'
  );
  INSERT INTO public.ai_approval_requests (
    tenant_id, run_id, action_kind, rationale, proposed_changes, consequences,
    target_entity_type, target_entity_id, target_state_version, requested_by_user_id
  ) VALUES (
    conversation.tenant_id, new_run, 'intake.create_draft_records',
    'Validated collected fields, current enabled catalog price, and two authoritative technician slot options.',
    proposed,
    'Approval may create one customer, one unscheduled new job, and one editable draft quote. It will not assign a technician, reserve a slot, send a quote, or confirm a booking.',
    'intake_conversation', conversation.id, state_version, auth.uid()
  ) RETURNING id INTO new_approval;
  INSERT INTO public.ai_run_steps (
    tenant_id, run_id, sequence_number, step_kind, tool_name,
    redacted_summary, outcome
  ) VALUES (
    conversation.tenant_id, new_run, 2, 'approval_requested',
    'intake.create_draft_records',
    'Created mandatory office approval for exact draft records and two non-reserved slot options.',
    'pending_approval'
  );
  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    conversation.tenant_id, auth.uid(), 'ai.intake_quote_slots_proposed',
    'intake_conversation', conversation.id,
    jsonb_build_object('run_id', new_run, 'approval_id', new_approval)
  );
  RETURN QUERY SELECT new_run, new_approval, 'proposed'::text,
    'Intake draft records and two slot options await office approval.'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.request_intake_quote_slot_proposal(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_intake_quote_slot_proposal(uuid, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.request_intake_quote_slot_proposal(uuid, uuid) IS
  'Creates an authoritative Intake quote/two-slot approval without creating customer, job, quote, assignment, or booking rows.';
