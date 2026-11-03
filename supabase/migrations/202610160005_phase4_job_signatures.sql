-- CrewFlow Phase 4: immutable customer signatures captured by the currently
-- assigned technician while work is in progress.

CREATE TABLE public.job_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL,
  captured_by_membership_id uuid NOT NULL,
  signer_name text NOT NULL,
  consent_text text NOT NULL,
  signature_strokes jsonb NOT NULL,
  signed_at timestamptz NOT NULL,
  integrity_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_signatures_job_tenant_fk
    FOREIGN KEY (job_id, tenant_id)
    REFERENCES public.jobs(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT job_signatures_capturer_tenant_fk
    FOREIGN KEY (captured_by_membership_id, tenant_id)
    REFERENCES public.memberships(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT job_signatures_one_per_job UNIQUE (job_id),
  CONSTRAINT job_signatures_signer_name_length CHECK (
    char_length(trim(signer_name)) BETWEEN 2 AND 120
  ),
  CONSTRAINT job_signatures_consent_length CHECK (
    char_length(consent_text) BETWEEN 20 AND 500
  ),
  CONSTRAINT job_signatures_strokes_array CHECK (
    jsonb_typeof(signature_strokes) = 'array'
  ),
  CONSTRAINT job_signatures_strokes_size CHECK (
    octet_length(signature_strokes::text) BETWEEN 10 AND 100000
  ),
  CONSTRAINT job_signatures_integrity_hash_format CHECK (
    integrity_hash ~ '^[0-9a-f]{64}$'
  )
);

CREATE INDEX job_signatures_tenant_time_idx
  ON public.job_signatures (tenant_id, signed_at DESC);

ALTER TABLE public.job_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY job_signatures_read_authorized ON public.job_signatures
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
    WHERE job.id = job_signatures.job_id
      AND job.tenant_id = job_signatures.tenant_id
      AND job.archived_at IS NULL
      AND membership.user_id = auth.uid()
      AND membership.role = 'technician'
      AND membership.status = 'active'
  )
);

CREATE FUNCTION public.record_assigned_job_signature(
  target_job_id uuid,
  customer_signer_name text,
  accepted_consent_text text,
  signature_strokes jsonb
)
RETURNS TABLE (
  signature_id uuid,
  signed_at timestamptz,
  integrity_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  required_consent CONSTANT text :=
    'I confirm that the work described above was completed and authorize this electronic signature to be attached to this CrewFlow job.';
  locked_job public.jobs%ROWTYPE;
  normalized_signer_name text := trim(coalesce(customer_signer_name, ''));
  signature_stroke jsonb;
  signature_point jsonb;
  point_x numeric;
  point_y numeric;
  new_signature_id uuid := extensions.gen_random_uuid();
  signature_signed_at timestamptz := clock_timestamp();
  signature_integrity_hash text;
  integrity_payload jsonb;
BEGIN
  IF char_length(normalized_signer_name) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'signer name must be between 2 and 120 characters'
      USING ERRCODE = '22023';
  END IF;

  IF accepted_consent_text IS DISTINCT FROM required_consent THEN
    RAISE EXCEPTION 'the required customer consent was not accepted'
      USING ERRCODE = '22023';
  END IF;

  IF signature_strokes IS NULL
    OR jsonb_typeof(signature_strokes) <> 'array'
    OR jsonb_array_length(signature_strokes) NOT BETWEEN 1 AND 40
    OR octet_length(signature_strokes::text) > 100000 THEN
    RAISE EXCEPTION 'signature strokes are missing or exceed allowed limits'
      USING ERRCODE = '22023';
  END IF;

  FOR signature_stroke IN
    SELECT value FROM jsonb_array_elements(signature_strokes)
  LOOP
    IF jsonb_typeof(signature_stroke) <> 'array'
      OR jsonb_array_length(signature_stroke) NOT BETWEEN 2 AND 500 THEN
      RAISE EXCEPTION 'each signature stroke must contain 2 to 500 points'
        USING ERRCODE = '22023';
    END IF;

    FOR signature_point IN
      SELECT value FROM jsonb_array_elements(signature_stroke)
    LOOP
      IF jsonb_typeof(signature_point) <> 'object'
        OR jsonb_typeof(signature_point -> 'x') <> 'number'
        OR jsonb_typeof(signature_point -> 'y') <> 'number' THEN
        RAISE EXCEPTION 'signature points require numeric x and y coordinates'
          USING ERRCODE = '22023';
      END IF;

      point_x := (signature_point ->> 'x')::numeric;
      point_y := (signature_point ->> 'y')::numeric;
      IF point_x NOT BETWEEN 0 AND 1 OR point_y NOT BETWEEN 0 AND 1 THEN
        RAISE EXCEPTION 'signature points must use normalized coordinates'
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END LOOP;

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

  IF locked_job.status <> 'in_progress' THEN
    RAISE EXCEPTION 'customer signature requires in-progress work'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.job_signatures AS existing_signature
    WHERE existing_signature.job_id = locked_job.id
  ) THEN
    RAISE EXCEPTION 'a customer signature is already recorded for this job'
      USING ERRCODE = '23505';
  END IF;

  integrity_payload := jsonb_build_object(
    'captured_by_membership_id', locked_job.assigned_membership_id,
    'consent_text', required_consent,
    'job_id', locked_job.id,
    'signature_id', new_signature_id,
    'signature_strokes', signature_strokes,
    'signed_at', signature_signed_at,
    'signer_name', normalized_signer_name,
    'tenant_id', locked_job.tenant_id
  );
  signature_integrity_hash := encode(
    extensions.digest(
      convert_to(integrity_payload::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.job_signatures (
    id,
    tenant_id,
    job_id,
    captured_by_membership_id,
    signer_name,
    consent_text,
    signature_strokes,
    signed_at,
    integrity_hash
  )
  VALUES (
    new_signature_id,
    locked_job.tenant_id,
    locked_job.id,
    locked_job.assigned_membership_id,
    normalized_signer_name,
    required_consent,
    signature_strokes,
    signature_signed_at,
    signature_integrity_hash
  );

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
    'job.customer_signature_recorded',
    'job',
    locked_job.id,
    jsonb_build_object(
      'signature_id', new_signature_id,
      'signed_at', signature_signed_at,
      'signer_name', normalized_signer_name,
      'integrity_hash', signature_integrity_hash
    )
  );

  RETURN QUERY
  SELECT new_signature_id, signature_signed_at, signature_integrity_hash;
END;
$$;

REVOKE ALL ON public.job_signatures FROM anon, authenticated;
GRANT SELECT ON public.job_signatures TO authenticated;

REVOKE ALL ON FUNCTION public.record_assigned_job_signature(
  uuid,
  text,
  text,
  jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_assigned_job_signature(
  uuid,
  text,
  text,
  jsonb
) TO authenticated;

COMMENT ON TABLE public.job_signatures IS
  'Immutable customer signatures with consent, server timestamp, job binding, and SHA-256 integrity evidence.';
COMMENT ON FUNCTION public.record_assigned_job_signature(
  uuid,
  text,
  text,
  jsonb
) IS
  'Records one validated customer signature for an in-progress job assigned to the active technician.';
