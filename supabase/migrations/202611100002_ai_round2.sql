-- AI Round 2.
--
-- 1. Quote assistant: office notes -> a draft list of catalog services and
--    quantities. The model may only pick service IDs from the workspace's own
--    enabled catalog; every price, name, and tax flag is taken from the
--    catalog by the database. A person reviews and sends the quote.
-- 2. Note translation: technician notes translated on request (Spanish <->
--    English), stored next to the original, which is never changed.
-- 3. Scheduling help: next open slots for a job and technician workload,
--    computed deterministically from availability, time off, skills, ZIP
--    coverage, and existing jobs. No model is involved.
--
-- Model runs go through begin_stub_ai_run, so AI must be enabled and the
-- monthly AI budget must have room. Every run is recorded with its cost.

-- ---------------------------------------------------------------------------
-- Quote assistant
-- ---------------------------------------------------------------------------

CREATE TABLE public.ai_quote_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL,
  run_id uuid NOT NULL,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  lines jsonb NOT NULL,
  missing_information text[] NOT NULL DEFAULT '{}',
  summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_quote_drafts_job_tenant_fk
    FOREIGN KEY (job_id, tenant_id)
    REFERENCES public.jobs(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT ai_quote_drafts_run_tenant_fk
    FOREIGN KEY (run_id, tenant_id)
    REFERENCES public.ai_agent_runs(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT ai_quote_drafts_lines_shape CHECK (
    jsonb_typeof(lines) = 'array'
    AND jsonb_array_length(lines) <= 20
    AND octet_length(lines::text) <= 20000
  ),
  CONSTRAINT ai_quote_drafts_missing_limit CHECK (
    cardinality(missing_information) <= 10
  ),
  CONSTRAINT ai_quote_drafts_summary_length CHECK (
    char_length(summary) BETWEEN 1 AND 600
  )
);

CREATE INDEX ai_quote_drafts_job_idx
  ON public.ai_quote_drafts (tenant_id, job_id, created_at DESC);

ALTER TABLE public.ai_quote_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_quote_drafts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ai_quote_drafts TO authenticated;
CREATE POLICY ai_quote_drafts_select ON public.ai_quote_drafts
  FOR SELECT TO authenticated
  USING (
    public.current_user_has_tenant_role(
      tenant_id, ARRAY['owner', 'office']::public.membership_role[]
    )
  );

-- Called with the user's own session: checks access and returns the job and
-- the enabled catalog the model may choose from.
CREATE FUNCTION public.prepare_ai_quote_draft(
  target_job_id uuid,
  target_notes text
)
RETURNS TABLE (tenant_id uuid, job_title text, catalog jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  job_row public.jobs%ROWTYPE;
  catalog_rows jsonb;
BEGIN
  SELECT job.* INTO job_row FROM public.jobs AS job WHERE job.id = target_job_id;
  IF job_row.id IS NULL OR NOT public.current_user_has_tenant_role(
    job_row.tenant_id, ARRAY['owner', 'office']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'job not found or unavailable' USING ERRCODE = '42501';
  END IF;
  IF job_row.archived_at IS NOT NULL OR job_row.status NOT IN ('new', 'quoted') THEN
    RAISE EXCEPTION 'quotes can only be drafted for new or quoted jobs'
      USING ERRCODE = 'P0001';
  END IF;
  IF target_notes IS NULL OR char_length(trim(target_notes)) NOT BETWEEN 10 AND 4000 THEN
    RAISE EXCEPTION 'notes must be 10 to 4000 characters' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', service.id,
      'name', service.name,
      'description', coalesce(service.description, ''),
      'durationMinutes', service.default_duration_minutes
    ) ORDER BY service.name), '[]'::jsonb)
  INTO catalog_rows
  FROM (
    SELECT * FROM public.services AS candidate
    WHERE candidate.tenant_id = job_row.tenant_id
      AND candidate.is_enabled
      AND candidate.archived_at IS NULL
    ORDER BY candidate.name
    LIMIT 100
  ) AS service;

  IF jsonb_array_length(catalog_rows) = 0 THEN
    RAISE EXCEPTION 'add services to your price list first' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY SELECT job_row.tenant_id, job_row.title, catalog_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_ai_quote_draft(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_ai_quote_draft(uuid, text) TO authenticated;

-- Marks a model run finished (succeeded or failed) with its real usage.
CREATE FUNCTION public.complete_ai_assist_run(
  target_run_id uuid,
  target_model text,
  target_input_tokens integer,
  target_output_tokens integer,
  target_cost_cents integer,
  target_duration_ms integer,
  target_error_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.ai_agent_runs
  SET provider = CASE WHEN target_model IS NULL THEN provider ELSE 'openai' END,
      model = coalesce(target_model, model),
      input_tokens = greatest(coalesce(target_input_tokens, 0), 0),
      output_tokens = greatest(coalesce(target_output_tokens, 0), 0),
      estimated_cost_cents = greatest(coalesce(target_cost_cents, 0), 0),
      duration_ms = target_duration_ms,
      status = CASE WHEN target_error_code IS NULL
        THEN 'succeeded'::public.ai_run_status
        ELSE 'failed'::public.ai_run_status END,
      error_code = left(target_error_code, 80),
      started_at = coalesce(started_at, created_at),
      completed_at = now()
  WHERE id = target_run_id
    AND status IN ('queued', 'running')
    AND agent_kind IN ('quote_assistant', 'translation');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI run is not open' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_ai_assist_run(uuid, text, integer, integer, integer, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_ai_assist_run(uuid, text, integer, integer, integer, integer, text)
  TO service_role;

-- Stores the draft. Only catalog services of this workspace survive; price,
-- name, and tax come from the catalog, never from the model.
CREATE FUNCTION public.record_ai_quote_draft(
  target_run_id uuid,
  target_job_id uuid,
  target_lines jsonb,
  target_missing_information text[],
  target_summary text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  run_row public.ai_agent_runs%ROWTYPE;
  validated jsonb;
  draft_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  SELECT run.* INTO run_row FROM public.ai_agent_runs AS run
  WHERE run.id = target_run_id AND run.agent_kind = 'quote_assistant'
  FOR UPDATE;
  IF run_row.id IS NULL OR run_row.status <> 'succeeded' THEN
    RAISE EXCEPTION 'quote assistant run is not complete' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.jobs AS job
    WHERE job.id = target_job_id AND job.tenant_id = run_row.tenant_id
  ) THEN
    RAISE EXCEPTION 'job not found' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(coalesce(target_lines, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'lines must be a list' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'serviceId', service.id,
      'description', service.name,
      'quantity', line.quantity,
      'unitPriceCents', service.unit_price_cents,
      'taxable', service.tax_behavior <> 'non_taxable',
      'reason', line.reason
    ) ORDER BY line.position), '[]'::jsonb)
  INTO validated
  FROM (
    SELECT
      item.position,
      item.value ->> 'serviceId' AS service_id,
      round(least(greatest((item.value ->> 'quantity')::numeric, 0.25), 100), 2) AS quantity,
      left(regexp_replace(coalesce(item.value ->> 'reason', ''), '[[:cntrl:]]', ' ', 'g'), 200) AS reason
    FROM jsonb_array_elements(coalesce(target_lines, '[]'::jsonb))
      WITH ORDINALITY AS item(value, position)
    WHERE item.position <= 20
      AND jsonb_typeof(item.value -> 'quantity') = 'number'
      AND (item.value ->> 'serviceId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) AS line
  JOIN public.services AS service
    ON service.id = line.service_id::uuid
   AND service.tenant_id = run_row.tenant_id
   AND service.is_enabled
   AND service.archived_at IS NULL;

  INSERT INTO public.ai_quote_drafts (
    tenant_id, job_id, run_id, created_by_user_id, lines,
    missing_information, summary
  ) VALUES (
    run_row.tenant_id, target_job_id, run_row.id, run_row.actor_user_id,
    validated,
    coalesce((
      SELECT array_agg(left(regexp_replace(question, '[[:cntrl:]]', ' ', 'g'), 200))
      FROM unnest(target_missing_information[1:10]) AS question
      WHERE char_length(trim(question)) > 0
    ), '{}'),
    left(coalesce(nullif(trim(regexp_replace(target_summary, '[[:cntrl:]]', ' ', 'g')), ''),
      'Draft prepared from your notes.'), 600)
  )
  RETURNING id INTO draft_id;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    run_row.tenant_id, run_row.actor_user_id, 'ai.quote_draft_created', 'job',
    target_job_id,
    jsonb_build_object('draft_id', draft_id, 'run_id', run_row.id,
      'line_count', jsonb_array_length(validated))
  );

  RETURN draft_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_ai_quote_draft(uuid, uuid, jsonb, text[], text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_quote_draft(uuid, uuid, jsonb, text[], text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Note translation
-- ---------------------------------------------------------------------------

CREATE TABLE public.job_note_translations (
  note_id uuid NOT NULL REFERENCES public.job_work_notes(id) ON DELETE CASCADE,
  target_language text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  translated_text text NOT NULL,
  run_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, target_language),
  CONSTRAINT job_note_translations_run_tenant_fk
    FOREIGN KEY (run_id, tenant_id)
    REFERENCES public.ai_agent_runs(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT job_note_translations_language CHECK (target_language IN ('en', 'es')),
  CONSTRAINT job_note_translations_text_length CHECK (
    char_length(translated_text) BETWEEN 1 AND 4000
  )
);

ALTER TABLE public.job_note_translations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_note_translations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.job_note_translations TO authenticated;
CREATE POLICY job_note_translations_select ON public.job_note_translations
  FOR SELECT TO authenticated
  USING (
    public.current_user_has_tenant_role(
      tenant_id, ARRAY['owner', 'office']::public.membership_role[]
    )
  );

CREATE FUNCTION public.prepare_note_translation(target_note_id uuid)
RETURNS TABLE (tenant_id uuid, body text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  note_row public.job_work_notes%ROWTYPE;
BEGIN
  SELECT note.* INTO note_row FROM public.job_work_notes AS note
  WHERE note.id = target_note_id;
  IF note_row.id IS NULL OR NOT public.current_user_has_tenant_role(
    note_row.tenant_id, ARRAY['owner', 'office']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'note not found or unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT note_row.tenant_id, note_row.body;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_note_translation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_note_translation(uuid) TO authenticated;

CREATE FUNCTION public.record_note_translation(
  target_run_id uuid,
  target_note_id uuid,
  target_language text,
  target_text text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  run_row public.ai_agent_runs%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  SELECT run.* INTO run_row FROM public.ai_agent_runs AS run
  WHERE run.id = target_run_id AND run.agent_kind = 'translation';
  IF run_row.id IS NULL OR run_row.status <> 'succeeded' THEN
    RAISE EXCEPTION 'translation run is not complete' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.job_work_notes AS note
    WHERE note.id = target_note_id AND note.tenant_id = run_row.tenant_id
  ) THEN
    RAISE EXCEPTION 'note not found' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.job_note_translations (
    note_id, target_language, tenant_id, translated_text, run_id
  ) VALUES (
    target_note_id, target_language, run_row.tenant_id,
    left(trim(regexp_replace(target_text, '[\x01-\x09\x0B-\x1F\x7F]', ' ', 'g')), 4000),
    run_row.id
  )
  ON CONFLICT (note_id, target_language) DO UPDATE
  SET translated_text = EXCLUDED.translated_text,
      run_id = EXCLUDED.run_id,
      created_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.record_note_translation(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_note_translation(uuid, uuid, text, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Scheduling help (deterministic)
-- ---------------------------------------------------------------------------

-- Next open start times (on the hour) in the next 14 days where an eligible
-- technician is available, not on time off, and has no overlapping job.
CREATE FUNCTION public.suggest_job_slots(
  target_job_id uuid,
  target_count integer DEFAULT 3
)
RETURNS TABLE (
  starts_at timestamptz,
  ends_at timestamptz,
  technician_membership_id uuid,
  technician_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  job_row public.jobs%ROWTYPE;
  zone text;
  duration_minutes integer;
  needed_skills text[];
  job_zip text;
  local_today date;
BEGIN
  SELECT job.* INTO job_row FROM public.jobs AS job WHERE job.id = target_job_id;
  IF job_row.id IS NULL OR NOT public.current_user_has_tenant_role(
    job_row.tenant_id, ARRAY['owner', 'office']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'job not found or unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT tenant.time_zone INTO zone FROM public.tenants AS tenant
  WHERE tenant.id = job_row.tenant_id;

  SELECT
    coalesce(
      CASE WHEN job_row.scheduled_start_at IS NOT NULL AND job_row.scheduled_end_at IS NOT NULL
        THEN (extract(epoch FROM job_row.scheduled_end_at - job_row.scheduled_start_at) / 60)::integer
      END,
      service.default_duration_minutes,
      60
    ),
    coalesce(service.required_skills, '{}')
  INTO duration_minutes, needed_skills
  FROM (SELECT 1) AS anchor
  LEFT JOIN public.services AS service
    ON service.id = job_row.service_id AND service.tenant_id = job_row.tenant_id;

  SELECT left(customer.postal_code, 5) INTO job_zip
  FROM public.customers AS customer
  WHERE customer.id = job_row.customer_id AND customer.tenant_id = job_row.tenant_id;

  local_today := (now() AT TIME ZONE zone)::date;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      membership.id AS technician_id,
      profile.full_name,
      (((local_today + day_offset.value) + availability.starts_at
        + make_interval(hours => step.value)) AT TIME ZONE zone) AS slot_start
    FROM generate_series(0, 13) AS day_offset(value)
    JOIN public.memberships AS membership
      ON membership.tenant_id = job_row.tenant_id
     AND membership.role = 'technician'
     AND membership.status = 'active'
    JOIN public.staff_profiles AS profile
      ON profile.membership_id = membership.id AND profile.tenant_id = membership.tenant_id
    JOIN public.staff_availability AS availability
      ON availability.membership_id = membership.id
     AND availability.tenant_id = membership.tenant_id
     AND availability.is_available
     AND availability.starts_at IS NOT NULL
     AND availability.ends_at IS NOT NULL
     AND availability.day_of_week = extract(dow FROM local_today + day_offset.value)::smallint
    CROSS JOIN LATERAL generate_series(
      0,
      floor(
        (extract(epoch FROM availability.ends_at - availability.starts_at) / 60
          - duration_minutes) / 60
      )::integer
    ) AS step(value)
    WHERE extract(epoch FROM availability.ends_at - availability.starts_at) / 60 >= duration_minutes
      AND (
        cardinality(profile.service_area_postal_codes) = 0
        OR job_zip = ANY (profile.service_area_postal_codes)
      )
      AND NOT EXISTS (
        SELECT 1 FROM unnest(needed_skills) AS required_skill
        WHERE NOT EXISTS (
          SELECT 1 FROM unnest(profile.skills) AS staff_skill
          WHERE lower(trim(staff_skill)) = lower(trim(required_skill))
        )
      )
  )
  SELECT
    candidate.slot_start,
    candidate.slot_start + make_interval(mins => duration_minutes),
    candidate.technician_id,
    candidate.full_name
  FROM candidates AS candidate
  WHERE candidate.slot_start > now()
    AND NOT EXISTS (
      SELECT 1 FROM public.staff_time_off AS time_off
      WHERE time_off.tenant_id = job_row.tenant_id
        AND time_off.membership_id = candidate.technician_id
        AND time_off.cancelled_at IS NULL
        AND time_off.starts_at < candidate.slot_start + make_interval(mins => duration_minutes)
        AND time_off.ends_at > candidate.slot_start
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.jobs AS other
      WHERE other.tenant_id = job_row.tenant_id
        AND other.id <> job_row.id
        AND other.assigned_membership_id = candidate.technician_id
        AND other.archived_at IS NULL
        AND other.status IN ('scheduled', 'in_progress')
        AND other.scheduled_start_at < candidate.slot_start + make_interval(mins => duration_minutes)
        AND other.scheduled_end_at > candidate.slot_start
    )
  ORDER BY candidate.slot_start, candidate.full_name
  LIMIT greatest(1, least(coalesce(target_count, 3), 10));
END;
$$;

REVOKE ALL ON FUNCTION public.suggest_job_slots(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggest_job_slots(uuid, integer) TO authenticated;

-- Per technician and day for the next N days: available vs scheduled minutes.
CREATE FUNCTION public.get_technician_workload(
  target_tenant_id uuid,
  target_days integer DEFAULT 7
)
RETURNS TABLE (
  technician_membership_id uuid,
  technician_name text,
  work_date date,
  job_count integer,
  scheduled_minutes integer,
  available_minutes integer,
  overbooked boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  zone text;
  local_today date;
BEGIN
  IF NOT public.current_user_has_tenant_role(
    target_tenant_id, ARRAY['owner', 'office']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'workload is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT tenant.time_zone INTO zone FROM public.tenants AS tenant
  WHERE tenant.id = target_tenant_id;
  local_today := (now() AT TIME ZONE zone)::date;

  RETURN QUERY
  WITH days AS (
    SELECT local_today + offset_value AS work_date
    FROM generate_series(0, greatest(1, least(coalesce(target_days, 7), 14)) - 1) AS offset_value
  ), technicians AS (
    SELECT membership.id, profile.full_name
    FROM public.memberships AS membership
    JOIN public.staff_profiles AS profile
      ON profile.membership_id = membership.id AND profile.tenant_id = membership.tenant_id
    WHERE membership.tenant_id = target_tenant_id
      AND membership.role = 'technician'
      AND membership.status = 'active'
  ), loads AS (
    SELECT
      technician.id,
      technician.full_name,
      day.work_date,
      count(job.id)::integer AS job_count,
      coalesce(sum(extract(epoch FROM job.scheduled_end_at - job.scheduled_start_at) / 60), 0)::integer
        AS scheduled_minutes,
      coalesce(max(
        CASE WHEN availability.is_available
          AND availability.starts_at IS NOT NULL AND availability.ends_at IS NOT NULL
          THEN extract(epoch FROM availability.ends_at - availability.starts_at) / 60
          ELSE 0 END
      ), 0)::integer AS available_minutes
    FROM technicians AS technician
    CROSS JOIN days AS day
    LEFT JOIN public.staff_availability AS availability
      ON availability.membership_id = technician.id
     AND availability.tenant_id = target_tenant_id
     AND availability.day_of_week = extract(dow FROM day.work_date)::smallint
    LEFT JOIN public.jobs AS job
      ON job.tenant_id = target_tenant_id
     AND job.assigned_membership_id = technician.id
     AND job.archived_at IS NULL
     AND job.status IN ('scheduled', 'in_progress')
     AND (job.scheduled_start_at AT TIME ZONE zone)::date = day.work_date
    GROUP BY technician.id, technician.full_name, day.work_date
  )
  SELECT
    loads.id,
    loads.full_name,
    loads.work_date,
    loads.job_count,
    loads.scheduled_minutes,
    loads.available_minutes,
    loads.scheduled_minutes > loads.available_minutes
  FROM loads
  WHERE loads.job_count > 0
  ORDER BY loads.work_date, loads.full_name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_technician_workload(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_technician_workload(uuid, integer) TO authenticated;
