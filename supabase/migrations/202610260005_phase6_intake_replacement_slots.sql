-- CrewFlow Phase 6: bounded replacement options for expired or invalid Intake
-- slots. Replacements remain preferences only and never schedule a job.

ALTER TABLE public.intake_slot_offers
  DROP CONSTRAINT intake_slot_offers_conversion_option_unique;

ALTER TABLE public.intake_slot_offers
  ADD COLUMN offer_generation smallint NOT NULL DEFAULT 1,
  ADD CONSTRAINT intake_slot_offers_generation_bounds
    CHECK (offer_generation BETWEEN 1 AND 5),
  ADD CONSTRAINT intake_slot_offers_conversion_generation_option_unique
    UNIQUE (conversion_id, offer_generation, option_number);

CREATE FUNCTION public.request_intake_replacement_slots(
  target_conversation_id uuid,
  session_token text DEFAULT NULL
)
RETURNS TABLE (
  replacement_result text,
  offer_generation integer,
  result_message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  conversation public.intake_conversations%ROWTYPE;
  conversion public.intake_draft_conversions%ROWTYPE;
  job public.jobs%ROWTYPE;
  service public.services%ROWTYPE;
  actor_user_id uuid;
  tenant_zone text;
  tenant_access public.billing_access_mode;
  customer_postal_code text;
  local_today date;
  next_generation integer;
  slot_count integer;
BEGIN
  SELECT item.* INTO conversation
  FROM public.intake_conversations AS item
  WHERE item.id = target_conversation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Intake conversation unavailable' USING ERRCODE = '42501';
  END IF;

  IF auth.role() = 'service_role' THEN
    IF session_token IS NULL OR char_length(session_token) NOT BETWEEN 43 AND 256
      OR conversation.session_token_hash <> pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(session_token, 'UTF8'), 'sha256'),
        'hex'
      ) THEN
      RAISE EXCEPTION 'Intake conversation unavailable' USING ERRCODE = '42501';
    END IF;
    actor_user_id := NULL;
  ELSIF auth.role() = 'authenticated' THEN
    IF NOT public.current_user_has_tenant_role(
      conversation.tenant_id,
      ARRAY['owner', 'office']::public.membership_role[]
    ) THEN
      RAISE EXCEPTION 'active office membership required' USING ERRCODE = '42501';
    END IF;
    actor_user_id := auth.uid();
  ELSE
    RAISE EXCEPTION 'Intake replacement access denied' USING ERRCODE = '42501';
  END IF;

  IF conversation.expires_at <= now() THEN
    RAISE EXCEPTION 'Intake conversation expired' USING ERRCODE = 'P0001';
  END IF;

  SELECT item.* INTO conversion
  FROM public.intake_draft_conversions AS item
  WHERE item.conversation_id = conversation.id
    AND item.tenant_id = conversation.tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approved Intake drafts are unavailable'
      USING ERRCODE = '22023';
  END IF;

  SELECT item.* INTO job
  FROM public.jobs AS item
  WHERE item.id = conversion.job_id
    AND item.tenant_id = conversion.tenant_id
  FOR UPDATE;
  IF NOT FOUND OR job.status NOT IN ('new', 'quoted', 'accepted')
    OR job.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Intake job is not eligible for replacement slots'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.intake_slot_offers AS offer
    WHERE offer.conversation_id = conversation.id
      AND offer.tenant_id = conversation.tenant_id
      AND offer.status = 'confirmed'
  ) THEN
    RETURN QUERY SELECT 'confirmed'::text,
      max(offer.offer_generation)::integer,
      'The appointment is already confirmed.'::text
    FROM public.intake_slot_offers AS offer
    WHERE offer.conversation_id = conversation.id;
    RETURN;
  END IF;

  SELECT tenant.time_zone, subscription.access_mode, customer.postal_code
  INTO tenant_zone, tenant_access, customer_postal_code
  FROM public.tenants AS tenant
  JOIN public.tenant_subscriptions AS subscription
    ON subscription.tenant_id = tenant.id
  JOIN public.customers AS customer
    ON customer.id = job.customer_id AND customer.tenant_id = tenant.id
  WHERE tenant.id = conversation.tenant_id
  ;

  SELECT catalog.* INTO service
  FROM public.services AS catalog
  WHERE catalog.id = job.service_id
    AND catalog.tenant_id = conversation.tenant_id
    AND catalog.is_enabled
    AND catalog.archived_at IS NULL;

  IF service.id IS NULL THEN
    RAISE EXCEPTION 'confirmed catalog service is unavailable'
      USING ERRCODE = '22023';
  END IF;
  IF tenant_access IS DISTINCT FROM 'full'::public.billing_access_mode THEN
    RAISE EXCEPTION 'full subscription access required' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(max(offer.offer_generation), 0) + 1
  INTO next_generation
  FROM public.intake_slot_offers AS offer
  WHERE offer.conversion_id = conversion.id;
  IF next_generation NOT BETWEEN 2 AND 5 THEN
    RAISE EXCEPTION 'replacement slot limit reached; contact the office'
      USING ERRCODE = 'P0001';
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
    FROM generate_series(1, 28) AS day_offset(value)
    JOIN public.memberships AS membership
      ON membership.tenant_id = conversation.tenant_id
      AND membership.role = 'technician'
      AND membership.status = 'active'
    JOIN public.staff_profiles AS profile
      ON profile.membership_id = membership.id
      AND profile.tenant_id = membership.tenant_id
    JOIN public.staff_availability AS availability
      ON availability.membership_id = membership.id
      AND availability.tenant_id = membership.tenant_id
      AND availability.day_of_week = extract(
        dow FROM local_today + day_offset.value
      )::smallint
      AND availability.is_available
    WHERE customer_postal_code = ANY(profile.service_area_postal_codes)
      AND NOT EXISTS (
        SELECT 1 FROM unnest(service.required_skills) AS required_skill
        WHERE NOT EXISTS (
          SELECT 1 FROM unnest(profile.skills) AS staff_skill
          WHERE lower(trim(staff_skill)) = lower(trim(required_skill))
        )
      )
      AND availability.starts_at
        + make_interval(mins => service.default_duration_minutes)
        <= availability.ends_at
  ), eligible_slots AS (
    SELECT candidate.*
    FROM candidate_slots AS candidate
    WHERE candidate.starts_at > now() + interval '30 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM public.staff_time_off AS time_off
        WHERE time_off.tenant_id = conversation.tenant_id
          AND time_off.membership_id = candidate.technician_id
          AND time_off.cancelled_at IS NULL
          AND time_off.starts_at < candidate.ends_at
          AND time_off.ends_at > candidate.starts_at
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.jobs AS conflict
        WHERE conflict.tenant_id = conversation.tenant_id
          AND conflict.assigned_membership_id = candidate.technician_id
          AND conflict.id <> job.id
          AND conflict.archived_at IS NULL
          AND conflict.status IN ('scheduled', 'in_progress')
          AND conflict.scheduled_start_at < candidate.ends_at
          AND conflict.scheduled_end_at > candidate.starts_at
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.intake_slot_offers AS prior
        WHERE prior.conversion_id = conversion.id
          AND prior.technician_membership_id = candidate.technician_id
          AND prior.starts_at = candidate.starts_at
          AND prior.ends_at = candidate.ends_at
      )
  ), ranked AS (
    SELECT DISTINCT ON (eligible.starts_at)
      eligible.technician_id, eligible.starts_at, eligible.ends_at
    FROM eligible_slots AS eligible
    ORDER BY eligible.starts_at, eligible.technician_id
    LIMIT 2
  )
  SELECT count(*)::integer INTO slot_count FROM ranked;

  IF slot_count < 2 THEN
    RAISE EXCEPTION 'two replacement slots are unavailable; contact the office'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.intake_slot_offers
  SET status = CASE
        WHEN starts_at <= now() THEN 'expired'::public.intake_slot_offer_status
        ELSE 'withdrawn'::public.intake_slot_offer_status
      END,
      selected_at = NULL,
      confirmed_at = NULL
  WHERE conversion_id = conversion.id
    AND status IN ('offered', 'selected');

  WITH candidate_slots AS (
    SELECT
      membership.id AS technician_id,
      ((local_today + day_offset.value) + availability.starts_at)
        AT TIME ZONE tenant_zone AS starts_at,
      (((local_today + day_offset.value) + availability.starts_at)
        AT TIME ZONE tenant_zone)
        + make_interval(mins => service.default_duration_minutes) AS ends_at
    FROM generate_series(1, 28) AS day_offset(value)
    JOIN public.memberships AS membership
      ON membership.tenant_id = conversation.tenant_id
      AND membership.role = 'technician'
      AND membership.status = 'active'
    JOIN public.staff_profiles AS profile
      ON profile.membership_id = membership.id
      AND profile.tenant_id = membership.tenant_id
    JOIN public.staff_availability AS availability
      ON availability.membership_id = membership.id
      AND availability.tenant_id = membership.tenant_id
      AND availability.day_of_week = extract(
        dow FROM local_today + day_offset.value
      )::smallint
      AND availability.is_available
    WHERE customer_postal_code = ANY(profile.service_area_postal_codes)
      AND NOT EXISTS (
        SELECT 1 FROM unnest(service.required_skills) AS required_skill
        WHERE NOT EXISTS (
          SELECT 1 FROM unnest(profile.skills) AS staff_skill
          WHERE lower(trim(staff_skill)) = lower(trim(required_skill))
        )
      )
      AND availability.starts_at
        + make_interval(mins => service.default_duration_minutes)
        <= availability.ends_at
  ), eligible_slots AS (
    SELECT candidate.*
    FROM candidate_slots AS candidate
    WHERE candidate.starts_at > now() + interval '30 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM public.staff_time_off AS time_off
        WHERE time_off.tenant_id = conversation.tenant_id
          AND time_off.membership_id = candidate.technician_id
          AND time_off.cancelled_at IS NULL
          AND time_off.starts_at < candidate.ends_at
          AND time_off.ends_at > candidate.starts_at
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.jobs AS conflict
        WHERE conflict.tenant_id = conversation.tenant_id
          AND conflict.assigned_membership_id = candidate.technician_id
          AND conflict.id <> job.id
          AND conflict.archived_at IS NULL
          AND conflict.status IN ('scheduled', 'in_progress')
          AND conflict.scheduled_start_at < candidate.ends_at
          AND conflict.scheduled_end_at > candidate.starts_at
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.intake_slot_offers AS prior
        WHERE prior.conversion_id = conversion.id
          AND prior.technician_membership_id = candidate.technician_id
          AND prior.starts_at = candidate.starts_at
          AND prior.ends_at = candidate.ends_at
      )
  ), deduplicated AS (
    SELECT DISTINCT ON (eligible.starts_at)
      eligible.technician_id, eligible.starts_at, eligible.ends_at
    FROM eligible_slots AS eligible
    ORDER BY eligible.starts_at, eligible.technician_id
  ), ranked AS (
    SELECT deduplicated.*,
      row_number() OVER (
        ORDER BY deduplicated.starts_at, deduplicated.technician_id
      )::smallint AS option_number
    FROM deduplicated
    ORDER BY deduplicated.starts_at, deduplicated.technician_id
    LIMIT 2
  )
  INSERT INTO public.intake_slot_offers (
    tenant_id, conversion_id, conversation_id, job_id,
    technician_membership_id, offer_generation, option_number,
    starts_at, ends_at
  )
  SELECT conversation.tenant_id, conversion.id, conversation.id, job.id,
    ranked.technician_id, next_generation, ranked.option_number,
    ranked.starts_at, ranked.ends_at
  FROM ranked;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    conversation.tenant_id, actor_user_id, 'ai.intake_slots_replaced',
    'intake_conversation', conversation.id,
    jsonb_build_object(
      'offer_generation', next_generation,
      'option_count', 2,
      'customer_token_action', actor_user_id IS NULL,
      'booking_confirmed', false
    )
  );

  RETURN QUERY SELECT 'replaced'::text, next_generation,
    'Two new preferences are available. No booking was created.'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_intake_slot_status(
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
  current_generation integer;
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
  SELECT max(offer.offer_generation) INTO current_generation
  FROM public.intake_slot_offers AS offer
  WHERE offer.conversion_id = conversion.id;

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
    AND offer.tenant_id = conversation.tenant_id
    AND offer.offer_generation = current_generation;

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
        AND offer.offer_generation = current_generation
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
    'offerGeneration', current_generation,
    'canRequestReplacement', public_state = 'slots_unavailable'
      AND current_generation < 5,
    'options', slot_options
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_intake_replacement_slots(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_intake_replacement_slots(uuid, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.request_intake_replacement_slots(uuid, text) IS
  'Creates at most four bounded generations of two fresh, conflict-free, non-reserved Intake preferences for an office actor or the hashed public session.';
