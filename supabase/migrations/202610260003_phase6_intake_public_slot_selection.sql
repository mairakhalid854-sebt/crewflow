-- CrewFlow Phase 6: public Intake slot selection with guarded office booking.
-- Customer selection records a preference only. A slot becomes a scheduled job
-- only after quote acceptance and an explicit office confirmation.

CREATE TYPE public.intake_slot_offer_status AS ENUM (
  'offered',
  'selected',
  'confirmed',
  'withdrawn',
  'expired'
);

ALTER TABLE public.intake_draft_conversions
  ADD CONSTRAINT intake_draft_conversions_id_tenant_unique
  UNIQUE (id, tenant_id);

CREATE TABLE public.intake_slot_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  conversion_id uuid NOT NULL REFERENCES public.intake_draft_conversions(id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL REFERENCES public.intake_conversations(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
  technician_membership_id uuid NOT NULL REFERENCES public.memberships(id) ON DELETE RESTRICT,
  option_number smallint NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status public.intake_slot_offer_status NOT NULL DEFAULT 'offered',
  selected_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intake_slot_offers_conversion_option_unique
    UNIQUE (conversion_id, option_number),
  CONSTRAINT intake_slot_offers_conversion_tenant_fk
    FOREIGN KEY (conversion_id, tenant_id)
    REFERENCES public.intake_draft_conversions(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT intake_slot_offers_conversation_tenant_fk
    FOREIGN KEY (conversation_id, tenant_id)
    REFERENCES public.intake_conversations(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT intake_slot_offers_job_tenant_fk
    FOREIGN KEY (job_id, tenant_id)
    REFERENCES public.jobs(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT intake_slot_offers_technician_tenant_fk
    FOREIGN KEY (technician_membership_id, tenant_id)
    REFERENCES public.memberships(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT intake_slot_offers_option_number CHECK (option_number BETWEEN 1 AND 2),
  CONSTRAINT intake_slot_offers_interval CHECK (starts_at < ends_at),
  CONSTRAINT intake_slot_offers_status_shape CHECK (
    (status IN ('offered', 'withdrawn', 'expired')
      AND selected_at IS NULL AND confirmed_at IS NULL)
    OR (status = 'selected' AND selected_at IS NOT NULL AND confirmed_at IS NULL)
    OR (status = 'confirmed' AND selected_at IS NOT NULL AND confirmed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX intake_slot_offers_one_choice_idx
  ON public.intake_slot_offers (conversation_id)
  WHERE status IN ('selected', 'confirmed');
CREATE INDEX intake_slot_offers_tenant_status_idx
  ON public.intake_slot_offers (tenant_id, status, starts_at);

ALTER TABLE public.intake_slot_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY intake_slot_offers_read_office
ON public.intake_slot_offers
FOR SELECT TO authenticated USING (
  public.current_user_has_tenant_role(
    tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  )
);

REVOKE ALL ON public.intake_slot_offers FROM anon, authenticated;
GRANT SELECT ON public.intake_slot_offers TO authenticated;

CREATE FUNCTION public.persist_intake_slot_offers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  approval public.ai_approval_requests%ROWTYPE;
  slot jsonb;
  slot_number integer := 0;
  slot_technician_id uuid;
  slot_starts_at timestamptz;
  slot_ends_at timestamptz;
BEGIN
  SELECT request.* INTO approval
  FROM public.ai_approval_requests AS request
  WHERE request.id = NEW.approval_id
    AND request.tenant_id = NEW.tenant_id
    AND request.action_kind = 'intake.create_draft_records'
    AND request.status = 'approved';

  IF approval.id IS NULL
    OR jsonb_typeof(approval.proposed_changes -> 'slotOptions') <> 'array'
    OR jsonb_array_length(approval.proposed_changes -> 'slotOptions') <> 2 THEN
    RAISE EXCEPTION 'approved Intake slot options are unavailable'
      USING ERRCODE = '22023';
  END IF;

  FOR slot IN
    SELECT value
    FROM jsonb_array_elements(approval.proposed_changes -> 'slotOptions')
  LOOP
    slot_number := slot_number + 1;
    BEGIN
      slot_technician_id := (slot ->> 'technicianMembershipId')::uuid;
      slot_starts_at := (slot ->> 'startsAt')::timestamptz;
      slot_ends_at := (slot ->> 'endsAt')::timestamptz;
    EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format
      OR datetime_field_overflow THEN
      RAISE EXCEPTION 'approved Intake slot option is invalid'
        USING ERRCODE = '22023';
    END;

    INSERT INTO public.intake_slot_offers (
      tenant_id, conversion_id, conversation_id, job_id,
      technician_membership_id, option_number, starts_at, ends_at
    ) VALUES (
      NEW.tenant_id, NEW.id, NEW.conversation_id, NEW.job_id,
      slot_technician_id, slot_number, slot_starts_at, slot_ends_at
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER intake_draft_conversions_persist_slot_offers
AFTER INSERT ON public.intake_draft_conversions
FOR EACH ROW EXECUTE FUNCTION public.persist_intake_slot_offers();

INSERT INTO public.intake_slot_offers (
  tenant_id, conversion_id, conversation_id, job_id,
  technician_membership_id, option_number, starts_at, ends_at
)
SELECT
  conversion.tenant_id,
  conversion.id,
  conversion.conversation_id,
  conversion.job_id,
  (slot.value ->> 'technicianMembershipId')::uuid,
  slot.ordinality::smallint,
  (slot.value ->> 'startsAt')::timestamptz,
  (slot.value ->> 'endsAt')::timestamptz
FROM public.intake_draft_conversions AS conversion
JOIN public.ai_approval_requests AS approval
  ON approval.id = conversion.approval_id
  AND approval.tenant_id = conversion.tenant_id
CROSS JOIN LATERAL jsonb_array_elements(
  approval.proposed_changes -> 'slotOptions'
) WITH ORDINALITY AS slot(value, ordinality)
WHERE approval.action_kind = 'intake.create_draft_records'
  AND approval.status = 'approved'
  AND approval.execution_status = 'succeeded'
  AND jsonb_typeof(approval.proposed_changes -> 'slotOptions') = 'array'
  AND jsonb_array_length(approval.proposed_changes -> 'slotOptions') = 2
  AND slot.ordinality BETWEEN 1 AND 2
ON CONFLICT (conversion_id, option_number) DO NOTHING;

CREATE FUNCTION public.get_public_intake_slot_status(
  target_conversation_id uuid,
  session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  conversation public.intake_conversations%ROWTYPE;
  conversion public.intake_draft_conversions%ROWTYPE;
  quote public.quotes%ROWTYPE;
  job public.jobs%ROWTYPE;
  tenant_time_zone text;
  service_name text;
  slot_options jsonb;
  public_state text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF session_token IS NULL OR char_length(session_token) NOT BETWEEN 43 AND 256 THEN
    RAISE EXCEPTION 'intake conversation unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT item.* INTO conversation
  FROM public.intake_conversations AS item
  WHERE item.id = target_conversation_id
    AND item.session_token_hash = pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(session_token, 'UTF8'), 'sha256'),
      'hex'
    );
  IF conversation.id IS NULL THEN
    RAISE EXCEPTION 'intake conversation unavailable' USING ERRCODE = '42501';
  END IF;
  IF conversation.expires_at <= now() THEN
    RAISE EXCEPTION 'intake conversation expired' USING ERRCODE = 'P0001';
  END IF;

  SELECT item.* INTO conversion
  FROM public.intake_draft_conversions AS item
  WHERE item.conversation_id = conversation.id
    AND item.tenant_id = conversation.tenant_id;
  IF conversion.id IS NULL THEN
    RETURN jsonb_build_object(
      'state', 'awaiting_office',
      'expiresAt', conversation.expires_at
    );
  END IF;

  SELECT item.* INTO quote FROM public.quotes AS item
  WHERE item.id = conversion.quote_id AND item.tenant_id = conversion.tenant_id;
  SELECT item.* INTO job FROM public.jobs AS item
  WHERE item.id = conversion.job_id AND item.tenant_id = conversion.tenant_id;
  SELECT tenant.time_zone, service.name INTO tenant_time_zone, service_name
  FROM public.tenants AS tenant
  JOIN public.services AS service
    ON service.id = job.service_id AND service.tenant_id = tenant.id
  WHERE tenant.id = conversion.tenant_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', offer.id,
    'startsAt', offer.starts_at,
    'endsAt', offer.ends_at,
    'status', CASE
      WHEN offer.status = 'offered' AND offer.starts_at <= now() THEN 'expired'
      ELSE offer.status::text
    END
  ) ORDER BY offer.option_number), '[]'::jsonb)
  INTO slot_options
  FROM public.intake_slot_offers AS offer
  WHERE offer.conversation_id = conversation.id
    AND offer.tenant_id = conversation.tenant_id;

  public_state := CASE
    WHEN EXISTS (
      SELECT 1 FROM public.intake_slot_offers AS offer
      WHERE offer.conversation_id = conversation.id AND offer.status = 'confirmed'
    ) THEN 'confirmed'
    WHEN EXISTS (
      SELECT 1 FROM public.intake_slot_offers AS offer
      WHERE offer.conversation_id = conversation.id AND offer.status = 'selected'
    ) THEN 'selection_pending_office'
    WHEN EXISTS (
      SELECT 1 FROM public.intake_slot_offers AS offer
      WHERE offer.conversation_id = conversation.id
        AND offer.status = 'offered' AND offer.starts_at > now()
    ) THEN 'slots_available'
    ELSE 'slots_unavailable'
  END;

  RETURN jsonb_build_object(
    'state', public_state,
    'expiresAt', conversation.expires_at,
    'serviceName', service_name,
    'timeZone', tenant_time_zone,
    'quoteStatus', quote.status,
    'quoteTotalCents', quote.total_cents,
    'jobStatus', job.status,
    'options', slot_options
  );
END;
$$;

CREATE FUNCTION public.select_public_intake_slot(
  target_conversation_id uuid,
  target_offer_id uuid,
  session_token text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  conversation public.intake_conversations%ROWTYPE;
  chosen public.intake_slot_offers%ROWTYPE;
  conversion public.intake_draft_conversions%ROWTYPE;
  job public.jobs%ROWTYPE;
  tenant_time_zone text;
  tenant_access public.billing_access_mode;
  customer_postal_code text;
  required_service_skills text[];
  slot_is_eligible boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  SELECT item.* INTO conversation
  FROM public.intake_conversations AS item
  WHERE item.id = target_conversation_id
    AND item.session_token_hash = pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(session_token, 'UTF8'), 'sha256'),
      'hex'
    )
  FOR UPDATE;
  IF conversation.id IS NULL THEN
    RAISE EXCEPTION 'intake conversation unavailable' USING ERRCODE = '42501';
  END IF;
  IF conversation.expires_at <= now() THEN
    RAISE EXCEPTION 'intake conversation expired' USING ERRCODE = 'P0001';
  END IF;

  SELECT offer.* INTO chosen
  FROM public.intake_slot_offers AS offer
  WHERE offer.id = target_offer_id
    AND offer.conversation_id = conversation.id
    AND offer.tenant_id = conversation.tenant_id
  FOR UPDATE;
  IF chosen.id IS NULL THEN
    RAISE EXCEPTION 'slot offer unavailable' USING ERRCODE = '22023';
  END IF;
  IF chosen.status IN ('selected', 'confirmed') THEN
    RETURN chosen.status::text;
  END IF;
  IF chosen.status <> 'offered' OR chosen.starts_at <= now() THEN
    RAISE EXCEPTION 'slot offer is no longer available' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.intake_slot_offers AS offer
    WHERE offer.conversation_id = conversation.id
      AND offer.status IN ('selected', 'confirmed')
  ) THEN
    RAISE EXCEPTION 'another slot was already selected' USING ERRCODE = 'P0001';
  END IF;

  SELECT item.* INTO conversion FROM public.intake_draft_conversions AS item
  WHERE item.id = chosen.conversion_id AND item.tenant_id = chosen.tenant_id;
  SELECT item.* INTO job FROM public.jobs AS item
  WHERE item.id = conversion.job_id AND item.tenant_id = conversion.tenant_id;
  SELECT tenant.time_zone, subscription.access_mode, customer.postal_code,
         coalesce(service.required_skills, '{}')
  INTO tenant_time_zone, tenant_access, customer_postal_code,
       required_service_skills
  FROM public.tenants AS tenant
  JOIN public.tenant_subscriptions AS subscription
    ON subscription.tenant_id = tenant.id
  JOIN public.customers AS customer
    ON customer.id = job.customer_id AND customer.tenant_id = tenant.id
  JOIN public.services AS service
    ON service.id = job.service_id AND service.tenant_id = tenant.id
  WHERE tenant.id = job.tenant_id AND service.is_enabled
    AND service.archived_at IS NULL;

  IF tenant_access IS DISTINCT FROM 'full'::public.billing_access_mode THEN
    RAISE EXCEPTION 'full subscription access required' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.memberships AS membership
    JOIN public.staff_profiles AS profile
      ON profile.membership_id = membership.id
      AND profile.tenant_id = membership.tenant_id
    JOIN public.staff_availability AS availability
      ON availability.membership_id = membership.id
      AND availability.tenant_id = membership.tenant_id
    WHERE membership.id = chosen.technician_membership_id
      AND membership.tenant_id = conversation.tenant_id
      AND membership.role = 'technician'
      AND membership.status = 'active'
      AND customer_postal_code = ANY(profile.service_area_postal_codes)
      AND NOT EXISTS (
        SELECT 1 FROM unnest(required_service_skills) AS required_skill
        WHERE NOT EXISTS (
          SELECT 1 FROM unnest(profile.skills) AS staff_skill
          WHERE lower(trim(staff_skill)) = lower(trim(required_skill))
        )
      )
      AND (chosen.starts_at AT TIME ZONE tenant_time_zone)::date
        = (chosen.ends_at AT TIME ZONE tenant_time_zone)::date
      AND availability.day_of_week = extract(
        dow FROM chosen.starts_at AT TIME ZONE tenant_time_zone
      )::smallint
      AND availability.is_available
      AND availability.starts_at <= (chosen.starts_at AT TIME ZONE tenant_time_zone)::time
      AND availability.ends_at >= (chosen.ends_at AT TIME ZONE tenant_time_zone)::time
      AND NOT EXISTS (
        SELECT 1 FROM public.staff_time_off AS time_off
        WHERE time_off.tenant_id = conversation.tenant_id
          AND time_off.membership_id = membership.id
          AND time_off.cancelled_at IS NULL
          AND time_off.starts_at < chosen.ends_at
          AND time_off.ends_at > chosen.starts_at
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.jobs AS conflict
        WHERE conflict.tenant_id = conversation.tenant_id
          AND conflict.assigned_membership_id = membership.id
          AND conflict.id <> job.id
          AND conflict.archived_at IS NULL
          AND conflict.status IN ('scheduled', 'in_progress')
          AND conflict.scheduled_start_at < chosen.ends_at
          AND conflict.scheduled_end_at > chosen.starts_at
      )
  ) INTO slot_is_eligible;

  IF NOT slot_is_eligible THEN
    RAISE EXCEPTION 'slot offer is no longer available' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.intake_slot_offers
  SET status = 'withdrawn'
  WHERE conversation_id = conversation.id AND status = 'offered'
    AND id <> chosen.id;
  UPDATE public.intake_slot_offers
  SET status = 'selected', selected_at = now()
  WHERE id = chosen.id;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    conversation.tenant_id, NULL, 'ai.intake_slot_selected',
    'intake_conversation', conversation.id,
    jsonb_build_object(
      'offer_id', chosen.id, 'job_id', job.id,
      'customer_token_action', true, 'booking_confirmed', false
    )
  );
  RETURN 'selected';
END;
$$;

CREATE FUNCTION public.confirm_intake_selected_slot(
  target_conversation_id uuid
)
RETURNS TABLE (
  confirmation_result text,
  job_id uuid,
  result_message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  chosen public.intake_slot_offers%ROWTYPE;
  conversion public.intake_draft_conversions%ROWTYPE;
  job public.jobs%ROWTYPE;
  tenant_access public.billing_access_mode;
  tenant_time_zone text;
  customer_postal_code text;
  required_service_skills text[];
  slot_is_eligible boolean;
BEGIN
  SELECT offer.* INTO chosen
  FROM public.intake_slot_offers AS offer
  WHERE offer.conversation_id = target_conversation_id
    AND offer.status IN ('selected', 'confirmed')
  FOR UPDATE;
  IF chosen.id IS NULL OR NOT public.current_user_has_tenant_role(
    chosen.tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'selected Intake slot not found or unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT item.* INTO conversion FROM public.intake_draft_conversions AS item
  WHERE item.id = chosen.conversion_id AND item.tenant_id = chosen.tenant_id;
  SELECT item.* INTO job FROM public.jobs AS item
  WHERE item.id = conversion.job_id AND item.tenant_id = conversion.tenant_id
  FOR UPDATE;

  IF chosen.status = 'confirmed'
    AND job.status = 'scheduled'
    AND job.assigned_membership_id = chosen.technician_membership_id
    AND job.scheduled_start_at = chosen.starts_at
    AND job.scheduled_end_at = chosen.ends_at THEN
    RETURN QUERY SELECT 'confirmed'::text, job.id,
      'This customer-selected slot is already confirmed.'::text;
    RETURN;
  END IF;

  SELECT subscription.access_mode, tenant.time_zone, customer.postal_code,
         coalesce(service.required_skills, '{}')
  INTO tenant_access, tenant_time_zone, customer_postal_code,
       required_service_skills
  FROM public.tenant_subscriptions AS subscription
  JOIN public.tenants AS tenant ON tenant.id = subscription.tenant_id
  JOIN public.customers AS customer
    ON customer.id = job.customer_id AND customer.tenant_id = tenant.id
  JOIN public.services AS service
    ON service.id = job.service_id AND service.tenant_id = tenant.id
  WHERE tenant.id = chosen.tenant_id AND service.is_enabled
    AND service.archived_at IS NULL;

  IF tenant_access IS DISTINCT FROM 'full'::public.billing_access_mode THEN
    RAISE EXCEPTION 'full subscription access required' USING ERRCODE = '42501';
  END IF;
  IF job.status <> 'accepted' THEN
    RAISE EXCEPTION 'customer quote acceptance is required before booking'
      USING ERRCODE = 'P0001';
  END IF;
  IF chosen.starts_at <= now() THEN
    RAISE EXCEPTION 'selected slot has expired' USING ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.memberships AS membership
    JOIN public.staff_profiles AS profile
      ON profile.membership_id = membership.id
      AND profile.tenant_id = membership.tenant_id
    JOIN public.staff_availability AS availability
      ON availability.membership_id = membership.id
      AND availability.tenant_id = membership.tenant_id
    WHERE membership.id = chosen.technician_membership_id
      AND membership.tenant_id = chosen.tenant_id
      AND membership.role = 'technician'
      AND membership.status = 'active'
      AND customer_postal_code = ANY(profile.service_area_postal_codes)
      AND NOT EXISTS (
        SELECT 1 FROM unnest(required_service_skills) AS required_skill
        WHERE NOT EXISTS (
          SELECT 1 FROM unnest(profile.skills) AS staff_skill
          WHERE lower(trim(staff_skill)) = lower(trim(required_skill))
        )
      )
      AND (chosen.starts_at AT TIME ZONE tenant_time_zone)::date
        = (chosen.ends_at AT TIME ZONE tenant_time_zone)::date
      AND availability.day_of_week = extract(
        dow FROM chosen.starts_at AT TIME ZONE tenant_time_zone
      )::smallint
      AND availability.is_available
      AND availability.starts_at <= (chosen.starts_at AT TIME ZONE tenant_time_zone)::time
      AND availability.ends_at >= (chosen.ends_at AT TIME ZONE tenant_time_zone)::time
      AND NOT EXISTS (
        SELECT 1 FROM public.staff_time_off AS time_off
        WHERE time_off.tenant_id = chosen.tenant_id
          AND time_off.membership_id = membership.id
          AND time_off.cancelled_at IS NULL
          AND time_off.starts_at < chosen.ends_at
          AND time_off.ends_at > chosen.starts_at
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.jobs AS conflict
        WHERE conflict.tenant_id = chosen.tenant_id
          AND conflict.assigned_membership_id = membership.id
          AND conflict.id <> job.id
          AND conflict.archived_at IS NULL
          AND conflict.status IN ('scheduled', 'in_progress')
          AND conflict.scheduled_start_at < chosen.ends_at
          AND conflict.scheduled_end_at > chosen.starts_at
      )
  ) INTO slot_is_eligible;
  IF NOT slot_is_eligible THEN
    RAISE EXCEPTION 'selected slot is no longer available; prepare new options'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.jobs
  SET assigned_membership_id = chosen.technician_membership_id,
      scheduled_start_at = chosen.starts_at,
      scheduled_end_at = chosen.ends_at,
      status = 'scheduled'
  WHERE id = job.id AND tenant_id = job.tenant_id;
  UPDATE public.intake_slot_offers
  SET status = 'confirmed', confirmed_at = now()
  WHERE id = chosen.id;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    chosen.tenant_id, auth.uid(), 'ai.intake_slot_confirmed',
    'job', job.id,
    jsonb_build_object(
      'offer_id', chosen.id, 'conversation_id', chosen.conversation_id,
      'technician_membership_id', chosen.technician_membership_id,
      'starts_at', chosen.starts_at, 'ends_at', chosen.ends_at
    )
  );
  RETURN QUERY SELECT 'confirmed'::text, job.id,
    'Customer-selected slot confirmed and job scheduled.'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_intake_slot_offers() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_intake_slot_status(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.select_public_intake_slot(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_intake_selected_slot(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_intake_slot_status(uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.select_public_intake_slot(uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_intake_selected_slot(uuid)
  TO authenticated;

COMMENT ON TABLE public.intake_slot_offers IS
  'Two office-approved Intake suggestions; customer selection is not a booking until guarded office confirmation.';
COMMENT ON FUNCTION public.select_public_intake_slot(uuid, uuid, text) IS
  'Records one session-authenticated customer slot preference after current eligibility checks; never schedules a job.';
COMMENT ON FUNCTION public.confirm_intake_selected_slot(uuid) IS
  'Schedules an accepted job only after explicit office confirmation and current eligibility revalidation.';
