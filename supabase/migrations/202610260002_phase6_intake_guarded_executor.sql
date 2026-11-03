-- CrewFlow Phase 6: guarded execution for approved Intake draft creation.
-- Execution creates editable internal drafts only. It never reserves a slot,
-- assigns a technician, sends a quote, or confirms a customer booking.

CREATE TABLE public.intake_draft_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL REFERENCES public.intake_conversations(id) ON DELETE RESTRICT,
  approval_id uuid NOT NULL REFERENCES public.ai_approval_requests(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intake_draft_conversions_conversation_unique UNIQUE (conversation_id),
  CONSTRAINT intake_draft_conversions_approval_unique UNIQUE (approval_id),
  CONSTRAINT intake_draft_conversions_job_unique UNIQUE (job_id),
  CONSTRAINT intake_draft_conversions_quote_unique UNIQUE (quote_id)
);

CREATE INDEX intake_draft_conversions_tenant_created_idx
  ON public.intake_draft_conversions (tenant_id, created_at DESC);

ALTER TABLE public.intake_draft_conversions ENABLE ROW LEVEL SECURITY;

CREATE POLICY intake_draft_conversions_read_office
ON public.intake_draft_conversions
FOR SELECT TO authenticated USING (
  public.current_user_has_tenant_role(
    tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  )
);

REVOKE ALL ON public.intake_draft_conversions FROM anon, authenticated;
GRANT SELECT ON public.intake_draft_conversions TO authenticated;

CREATE FUNCTION public.execute_approved_intake_draft_records(
  target_approval_id uuid
)
RETURNS TABLE (
  execution_result text,
  customer_id uuid,
  job_id uuid,
  quote_id uuid,
  result_message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  approval public.ai_approval_requests%ROWTYPE;
  conversation public.intake_conversations%ROWTYPE;
  service public.services%ROWTYPE;
  prior_conversion public.intake_draft_conversions%ROWTYPE;
  tenant_tax integer;
  tenant_access public.billing_access_mode;
  customer_name text;
  customer_first_name text;
  customer_last_name text;
  contact_kind text;
  contact_value text;
  address_value text;
  problem_value text;
  postal_value text;
  subtotal bigint;
  tax_cents bigint;
  total bigint;
  expected_changes jsonb;
  expected_state_version text;
  proposed_slots jsonb;
  slot jsonb;
  slot_technician_id uuid;
  slot_starts_at timestamptz;
  slot_ends_at timestamptz;
  slot_is_eligible boolean;
  valid_slot_count integer := 0;
  next_step_number integer;
  rejection_kind text;
  rejection_message text;
  new_customer_id uuid;
  new_job_id uuid;
  new_quote_id uuid;
BEGIN
  SELECT request.* INTO approval
  FROM public.ai_approval_requests AS request
  WHERE request.id = target_approval_id
  FOR UPDATE;

  IF approval.id IS NULL OR NOT public.current_user_has_tenant_role(
    approval.tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'approval not found or unavailable' USING ERRCODE = '42501';
  END IF;

  IF approval.action_kind <> 'intake.create_draft_records'
    OR approval.target_entity_type <> 'intake_conversation'
    OR approval.target_entity_id IS NULL THEN
    RAISE EXCEPTION 'approval is not an Intake draft request' USING ERRCODE = '22023';
  END IF;

  IF approval.status <> 'approved' THEN
    RAISE EXCEPTION 'Intake draft creation requires an approved request'
      USING ERRCODE = 'P0001';
  END IF;

  IF approval.execution_status IS NOT NULL THEN
    SELECT conversion.* INTO prior_conversion
    FROM public.intake_draft_conversions AS conversion
    WHERE conversion.approval_id = approval.id;
    RETURN QUERY SELECT approval.execution_status,
      prior_conversion.customer_id, prior_conversion.job_id,
      prior_conversion.quote_id, approval.execution_message;
    RETURN;
  END IF;

  SELECT conversion.* INTO prior_conversion
  FROM public.intake_draft_conversions AS conversion
  WHERE conversion.conversation_id = approval.target_entity_id;
  IF prior_conversion.id IS NOT NULL THEN
    rejection_kind := 'rejected_policy';
    rejection_message := 'This Intake conversation was already converted to draft records.';
  END IF;

  IF rejection_kind IS NULL THEN
    SELECT item.* INTO conversation
    FROM public.intake_conversations AS item
    WHERE item.id = approval.target_entity_id
      AND item.tenant_id = approval.tenant_id
    FOR UPDATE;

    IF conversation.id IS NULL
      OR conversation.status <> 'ready_for_human_review'
      OR conversation.stage <> 'complete'
      OR conversation.selected_service_id IS NULL THEN
      rejection_kind := 'rejected_stale';
      rejection_message := 'Intake state changed. Create a fresh proposal before making drafts.';
    END IF;
  END IF;

  IF rejection_kind IS NULL THEN
    SELECT item.* INTO service
    FROM public.services AS item
    WHERE item.id = conversation.selected_service_id
      AND item.tenant_id = conversation.tenant_id
      AND item.is_enabled
      AND item.archived_at IS NULL;
    SELECT tenant.tax_rate_bps, subscription.access_mode
    INTO tenant_tax, tenant_access
    FROM public.tenants AS tenant
    JOIN public.tenant_subscriptions AS subscription
      ON subscription.tenant_id = tenant.id
    WHERE tenant.id = conversation.tenant_id;

    IF service.id IS NULL THEN
      rejection_kind := 'rejected_stale';
      rejection_message := 'The approved catalog service is no longer available.';
    ELSIF tenant_access IS DISTINCT FROM 'full'::public.billing_access_mode THEN
      rejection_kind := 'rejected_policy';
      rejection_message := 'Full subscription access is required to create Intake drafts.';
    END IF;
  END IF;

  IF rejection_kind IS NULL THEN
    customer_name := trim(conversation.collected_values ->> 'customerName');
    contact_kind := trim(conversation.collected_values #>> '{contact,kind}');
    contact_value := trim(conversation.collected_values #>> '{contact,value}');
    address_value := trim(conversation.collected_values ->> 'address');
    problem_value := trim(conversation.collected_values ->> 'problem');
    postal_value := coalesce(
      substring(address_value FROM '[0-9]{5}-[0-9]{4}'),
      substring(address_value FROM '[0-9]{5}')
    );
    proposed_slots := approval.proposed_changes -> 'slotOptions';

    IF char_length(customer_name) NOT BETWEEN 2 AND 120
      OR char_length(address_value) NOT BETWEEN 10 AND 300
      OR char_length(problem_value) NOT BETWEEN 10 AND 2000
      OR postal_value IS NULL
      OR (contact_kind = 'email'
        AND contact_value !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
      OR (contact_kind = 'phone' AND contact_value !~ '^\+1[0-9]{10}$')
      OR contact_kind NOT IN ('email', 'phone')
      OR jsonb_typeof(proposed_slots) <> 'array'
      OR jsonb_array_length(proposed_slots) <> 2 THEN
      rejection_kind := 'rejected_stale';
      rejection_message := 'Approved Intake details or slot options are no longer valid.';
    END IF;
  END IF;

  IF rejection_kind IS NULL THEN
    subtotal := service.unit_price_cents;
    tax_cents := CASE WHEN service.tax_behavior = 'non_taxable' THEN 0
      ELSE round(subtotal::numeric * tenant_tax / 10000)::bigint END;
    total := subtotal + tax_cents;
    expected_changes := jsonb_build_object(
      'customer', jsonb_build_object(
        'name', customer_name, 'contactKind', contact_kind,
        'contactValue', contact_value, 'address', address_value,
        'postalCode', postal_value
      ),
      'job', jsonb_build_object(
        'title', service.name, 'description', problem_value,
        'serviceId', service.id
      ),
      'quote', jsonb_build_object(
        'description', service.name, 'quantity', 1,
        'unitPriceCents', service.unit_price_cents,
        'taxable', service.tax_behavior <> 'non_taxable',
        'subtotalCents', subtotal, 'taxRateBps', tenant_tax,
        'taxCents', tax_cents, 'totalCents', total
      ),
      'slotOptions', proposed_slots
    );
    expected_state_version := encode(extensions.digest(convert_to(concat_ws('|',
      conversation.id, conversation.version, service.id, service.updated_at,
      service.unit_price_cents, tenant_tax, expected_changes::text
    ), 'UTF8'), 'sha256'), 'hex');

    IF approval.proposed_changes IS DISTINCT FROM expected_changes
      OR approval.target_state_version IS DISTINCT FROM expected_state_version THEN
      rejection_kind := 'rejected_stale';
      rejection_message := 'Pricing or Intake details changed. Create a fresh proposal.';
    END IF;
  END IF;

  IF rejection_kind IS NULL THEN
    FOR slot IN SELECT value FROM jsonb_array_elements(proposed_slots)
    LOOP
      BEGIN
        slot_technician_id := (slot ->> 'technicianMembershipId')::uuid;
        slot_starts_at := (slot ->> 'startsAt')::timestamptz;
        slot_ends_at := (slot ->> 'endsAt')::timestamptz;
      EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format
        OR datetime_field_overflow THEN
        slot_technician_id := NULL;
        slot_starts_at := NULL;
        slot_ends_at := NULL;
      END;

      SELECT EXISTS (
        SELECT 1
        FROM public.memberships AS membership
        JOIN public.staff_profiles AS profile
          ON profile.membership_id = membership.id
          AND profile.tenant_id = membership.tenant_id
        JOIN public.tenants AS tenant ON tenant.id = membership.tenant_id
        JOIN public.staff_availability AS availability
          ON availability.membership_id = membership.id
          AND availability.tenant_id = membership.tenant_id
        WHERE membership.id = slot_technician_id
          AND membership.tenant_id = conversation.tenant_id
          AND membership.role = 'technician'
          AND membership.status = 'active'
          AND slot_starts_at > now()
          AND slot_ends_at = slot_starts_at
            + make_interval(mins => service.default_duration_minutes)
          AND postal_value = ANY(profile.service_area_postal_codes)
          AND NOT EXISTS (
            SELECT 1 FROM unnest(service.required_skills) AS required_skill
            WHERE NOT EXISTS (
              SELECT 1 FROM unnest(profile.skills) AS staff_skill
              WHERE lower(trim(staff_skill)) = lower(trim(required_skill))
            )
          )
          AND (slot_starts_at AT TIME ZONE tenant.time_zone)::date
            = (slot_ends_at AT TIME ZONE tenant.time_zone)::date
          AND availability.day_of_week = extract(
            dow FROM slot_starts_at AT TIME ZONE tenant.time_zone
          )::smallint
          AND availability.is_available
          AND availability.starts_at <= (slot_starts_at AT TIME ZONE tenant.time_zone)::time
          AND availability.ends_at >= (slot_ends_at AT TIME ZONE tenant.time_zone)::time
          AND NOT EXISTS (
            SELECT 1 FROM public.staff_time_off AS time_off
            WHERE time_off.tenant_id = conversation.tenant_id
              AND time_off.membership_id = membership.id
              AND time_off.cancelled_at IS NULL
              AND time_off.starts_at < slot_ends_at
              AND time_off.ends_at > slot_starts_at
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.jobs AS conflict
            WHERE conflict.tenant_id = conversation.tenant_id
              AND conflict.assigned_membership_id = membership.id
              AND conflict.archived_at IS NULL
              AND conflict.status IN ('scheduled', 'in_progress')
              AND conflict.scheduled_start_at < slot_ends_at
              AND conflict.scheduled_end_at > slot_starts_at
          )
      ) INTO slot_is_eligible;

      IF slot_is_eligible THEN
        valid_slot_count := valid_slot_count + 1;
      END IF;
    END LOOP;

    IF valid_slot_count <> 2 THEN
      rejection_kind := 'rejected_policy';
      rejection_message := 'One or more suggested slots are no longer eligible. Create a fresh proposal.';
    END IF;
  END IF;

  IF rejection_kind IS NOT NULL THEN
    UPDATE public.ai_approval_requests
    SET execution_status = rejection_kind,
        executed_at = now(),
        executed_by_user_id = auth.uid(),
        execution_message = rejection_message
    WHERE id = approval.id;

    SELECT coalesce(max(step.sequence_number), 0) + 1 INTO next_step_number
    FROM public.ai_run_steps AS step WHERE step.run_id = approval.run_id;
    INSERT INTO public.ai_run_steps (
      tenant_id, run_id, sequence_number, step_kind, tool_name,
      redacted_summary, outcome, duration_ms
    ) VALUES (
      approval.tenant_id, approval.run_id, next_step_number,
      'guarded_execution', 'intake.create_draft_records',
      rejection_message, rejection_kind, 0
    );
    INSERT INTO public.audit_events (
      tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
      approval.tenant_id, auth.uid(), 'ai.intake_execution_rejected',
      'intake_conversation', approval.target_entity_id,
      jsonb_build_object(
        'approval_id', approval.id, 'run_id', approval.run_id,
        'reason', rejection_kind
      )
    );
    RETURN QUERY SELECT rejection_kind, NULL::uuid, NULL::uuid, NULL::uuid,
      rejection_message;
    RETURN;
  END IF;

  customer_first_name := split_part(customer_name, ' ', 1);
  customer_last_name := nullif(trim(substring(customer_name FROM char_length(customer_first_name) + 1)), '');
  IF customer_last_name IS NULL THEN
    customer_last_name := 'Customer';
  END IF;

  INSERT INTO public.customers (
    tenant_id, first_name, last_name, email, phone, street_address,
    postal_code, notes, transactional_email_allowed
  ) VALUES (
    conversation.tenant_id, left(customer_first_name, 80),
    left(customer_last_name, 80),
    CASE WHEN contact_kind = 'email' THEN contact_value ELSE NULL END,
    CASE WHEN contact_kind = 'phone' THEN contact_value ELSE NULL END,
    address_value, postal_value,
    'Created from approved Intake conversation ' || conversation.id::text,
    true
  ) RETURNING id INTO new_customer_id;

  INSERT INTO public.jobs (
    tenant_id, customer_id, service_id, title, description, priority, status
  ) VALUES (
    conversation.tenant_id, new_customer_id, service.id, service.name,
    problem_value, 'normal', 'new'
  ) RETURNING id INTO new_job_id;

  INSERT INTO public.quotes (
    tenant_id, job_id, customer_id, status, subtotal_cents, discount_cents,
    tax_rate_bps, tax_cents, total_cents, expires_at, created_by_user_id
  ) VALUES (
    conversation.tenant_id, new_job_id, new_customer_id, 'draft', subtotal,
    0, tenant_tax, tax_cents, total, now() + interval '14 days', auth.uid()
  ) RETURNING id INTO new_quote_id;

  INSERT INTO public.quote_line_items (
    tenant_id, quote_id, position, description, quantity,
    unit_price_cents, taxable, line_total_cents
  ) VALUES (
    conversation.tenant_id, new_quote_id, 1, service.name, 1,
    service.unit_price_cents, service.tax_behavior <> 'non_taxable',
    service.unit_price_cents
  );

  INSERT INTO public.intake_draft_conversions (
    tenant_id, conversation_id, approval_id, customer_id, job_id, quote_id,
    created_by_user_id
  ) VALUES (
    conversation.tenant_id, conversation.id, approval.id, new_customer_id,
    new_job_id, new_quote_id, auth.uid()
  );

  UPDATE public.ai_approval_requests
  SET execution_status = 'succeeded',
      executed_at = now(),
      executed_by_user_id = auth.uid(),
      execution_message = 'Approved customer, unscheduled job, and editable quote drafts were created after current-state revalidation.'
  WHERE id = approval.id;

  SELECT coalesce(max(step.sequence_number), 0) + 1 INTO next_step_number
  FROM public.ai_run_steps AS step WHERE step.run_id = approval.run_id;
  INSERT INTO public.ai_run_steps (
    tenant_id, run_id, sequence_number, step_kind, tool_name,
    redacted_summary, outcome, duration_ms
  ) VALUES (
    approval.tenant_id, approval.run_id, next_step_number,
    'guarded_execution', 'intake.create_draft_records',
    'Created one customer, one unscheduled new job, and one editable draft quote. No slot was reserved and nothing was sent.',
    'succeeded', 0
  );
  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    approval.tenant_id, auth.uid(), 'ai.intake_drafts_created',
    'intake_conversation', conversation.id,
    jsonb_build_object(
      'approval_id', approval.id, 'run_id', approval.run_id,
      'customer_id', new_customer_id, 'job_id', new_job_id,
      'quote_id', new_quote_id, 'slot_reserved', false
    )
  );

  RETURN QUERY SELECT 'succeeded'::text, new_customer_id, new_job_id,
    new_quote_id, 'Approved Intake drafts created. Suggested slots remain unreserved.'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_approved_intake_draft_records(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_approved_intake_draft_records(uuid)
  TO authenticated;

COMMENT ON TABLE public.intake_draft_conversions IS
  'Immutable link proving one approved Intake conversation created exactly one customer/job/quote draft set.';
COMMENT ON FUNCTION public.execute_approved_intake_draft_records(uuid) IS
  'Idempotently creates approved Intake drafts after role, subscription, source, pricing, and slot revalidation; it never books or sends.';
