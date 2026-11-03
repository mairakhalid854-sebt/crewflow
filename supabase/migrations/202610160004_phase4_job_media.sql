-- CrewFlow Phase 4: private before/after job photos with a guarded
-- reservation, upload, and finalize lifecycle.

CREATE TYPE public.job_media_kind AS ENUM ('before', 'after');

CREATE TABLE public.job_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL,
  uploader_membership_id uuid NOT NULL,
  media_kind public.job_media_kind NOT NULL,
  storage_path text NOT NULL UNIQUE,
  content_type text NOT NULL,
  byte_size bigint NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  uploaded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_media_job_tenant_fk
    FOREIGN KEY (job_id, tenant_id)
    REFERENCES public.jobs(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT job_media_uploader_tenant_fk
    FOREIGN KEY (uploader_membership_id, tenant_id)
    REFERENCES public.memberships(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT job_media_storage_path_length CHECK (
    char_length(storage_path) BETWEEN 10 AND 240
  ),
  CONSTRAINT job_media_content_type_allowed CHECK (
    content_type = 'image/jpeg'
  ),
  CONSTRAINT job_media_byte_size_allowed CHECK (
    byte_size BETWEEN 1 AND 5242880
  )
);

CREATE INDEX job_media_job_time_idx
  ON public.job_media (job_id, captured_at DESC);
CREATE INDEX job_media_tenant_time_idx
  ON public.job_media (tenant_id, captured_at DESC);

ALTER TABLE public.job_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY job_media_read_authorized ON public.job_media
FOR SELECT TO authenticated USING (
  (
    uploaded_at IS NOT NULL
    AND public.current_user_has_tenant_role(
      tenant_id,
      ARRAY['owner', 'office']::public.membership_role[]
    )
  )
  OR EXISTS (
    SELECT 1
    FROM public.jobs AS job
    JOIN public.memberships AS membership
      ON membership.id = job.assigned_membership_id
      AND membership.tenant_id = job.tenant_id
    WHERE job.id = job_media.job_id
      AND job.tenant_id = job_media.tenant_id
      AND job.archived_at IS NULL
      AND membership.user_id = auth.uid()
      AND membership.role = 'technician'
      AND membership.status = 'active'
      AND (
        job_media.uploaded_at IS NOT NULL
        OR job_media.uploader_membership_id = membership.id
      )
  )
);

CREATE FUNCTION public.reserve_assigned_job_media(
  target_job_id uuid,
  target_media_kind public.job_media_kind,
  media_content_type text,
  media_size_bytes bigint
)
RETURNS TABLE (media_id uuid, storage_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  locked_job public.jobs%ROWTYPE;
  new_media_id uuid := gen_random_uuid();
  new_storage_path text;
BEGIN
  IF media_content_type <> 'image/jpeg' THEN
    RAISE EXCEPTION 'job photos must be JPEG images' USING ERRCODE = '22023';
  END IF;

  IF media_size_bytes NOT BETWEEN 1 AND 5242880 THEN
    RAISE EXCEPTION 'job photo must be between 1 byte and 5 MB'
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

  IF target_media_kind = 'before'
    AND locked_job.status NOT IN ('scheduled', 'in_progress') THEN
    RAISE EXCEPTION 'before photos require scheduled or in-progress work'
      USING ERRCODE = '22023';
  END IF;

  IF target_media_kind = 'after' AND locked_job.status <> 'in_progress' THEN
    RAISE EXCEPTION 'after photos require in-progress work'
      USING ERRCODE = '22023';
  END IF;

  IF (
    SELECT count(*)
    FROM public.job_media AS media
    WHERE media.job_id = locked_job.id
      AND (
        media.uploaded_at IS NOT NULL
        OR media.created_at > now() - interval '15 minutes'
      )
  ) >= 20 THEN
    RAISE EXCEPTION 'job photo limit reached' USING ERRCODE = '22023';
  END IF;

  new_storage_path := concat(
    locked_job.tenant_id,
    '/',
    locked_job.id,
    '/',
    new_media_id,
    '.jpg'
  );

  INSERT INTO public.job_media (
    id,
    tenant_id,
    job_id,
    uploader_membership_id,
    media_kind,
    storage_path,
    content_type,
    byte_size
  )
  VALUES (
    new_media_id,
    locked_job.tenant_id,
    locked_job.id,
    locked_job.assigned_membership_id,
    target_media_kind,
    new_storage_path,
    media_content_type,
    media_size_bytes
  );

  RETURN QUERY SELECT new_media_id, new_storage_path;
END;
$$;

CREATE FUNCTION public.finalize_assigned_job_media(target_media_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  locked_media public.job_media%ROWTYPE;
  object_metadata jsonb;
  stored_content_type text;
  stored_size bigint;
BEGIN
  SELECT media.*
  INTO locked_media
  FROM public.job_media AS media
  JOIN public.jobs AS job
    ON job.id = media.job_id
    AND job.tenant_id = media.tenant_id
  JOIN public.memberships AS membership
    ON membership.id = job.assigned_membership_id
    AND membership.tenant_id = job.tenant_id
  WHERE media.id = target_media_id
    AND job.archived_at IS NULL
    AND media.uploader_membership_id = membership.id
    AND membership.user_id = auth.uid()
    AND membership.role = 'technician'
    AND membership.status = 'active'
  FOR UPDATE OF media;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job photo reservation not found or unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF locked_media.uploaded_at IS NOT NULL THEN
    RETURN locked_media.id;
  END IF;

  SELECT object.metadata
  INTO object_metadata
  FROM storage.objects AS object
  WHERE object.bucket_id = 'job-media'
    AND object.name = locked_media.storage_path;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job photo upload is incomplete' USING ERRCODE = '22023';
  END IF;

  stored_content_type := lower(coalesce(object_metadata ->> 'mimetype', ''));
  stored_size := nullif(object_metadata ->> 'size', '')::bigint;

  IF stored_content_type <> locked_media.content_type THEN
    RAISE EXCEPTION 'uploaded job photo content type does not match reservation'
      USING ERRCODE = '22023';
  END IF;

  IF stored_size IS NULL OR stored_size <> locked_media.byte_size THEN
    RAISE EXCEPTION 'uploaded job photo size does not match reservation'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.job_media
  SET uploaded_at = now()
  WHERE id = locked_media.id;

  INSERT INTO public.audit_events (
    tenant_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  VALUES (
    locked_media.tenant_id,
    auth.uid(),
    'job.photo_uploaded',
    'job',
    locked_media.job_id,
    jsonb_build_object(
      'media_id', locked_media.id,
      'media_kind', locked_media.media_kind,
      'byte_size', locked_media.byte_size,
      'content_type', locked_media.content_type
    )
  );

  RETURN locked_media.id;
END;
$$;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'job-media',
  'job-media',
  false,
  5242880,
  ARRAY['image/jpeg']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY job_media_objects_insert_assigned_technician
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'job-media'
  AND EXISTS (
    SELECT 1
    FROM public.job_media AS media
    JOIN public.jobs AS job
      ON job.id = media.job_id
      AND job.tenant_id = media.tenant_id
    JOIN public.memberships AS membership
      ON membership.id = job.assigned_membership_id
      AND membership.tenant_id = job.tenant_id
    WHERE media.storage_path = name
      AND media.uploaded_at IS NULL
      AND media.created_at > now() - interval '15 minutes'
      AND media.uploader_membership_id = membership.id
      AND membership.user_id = auth.uid()
      AND membership.role = 'technician'
      AND membership.status = 'active'
  )
);

CREATE POLICY job_media_objects_read_authorized
ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'job-media'
  AND EXISTS (
    SELECT 1
    FROM public.job_media AS media
    JOIN public.jobs AS job
      ON job.id = media.job_id
      AND job.tenant_id = media.tenant_id
    WHERE media.storage_path = name
      AND media.uploaded_at IS NOT NULL
      AND (
        public.current_user_has_tenant_role(
          media.tenant_id,
          ARRAY['owner', 'office']::public.membership_role[]
        )
        OR EXISTS (
          SELECT 1
          FROM public.memberships AS membership
          WHERE membership.id = job.assigned_membership_id
            AND membership.tenant_id = job.tenant_id
            AND membership.user_id = auth.uid()
            AND membership.role = 'technician'
            AND membership.status = 'active'
        )
      )
  )
);

REVOKE ALL ON public.job_media FROM anon, authenticated;
GRANT SELECT ON public.job_media TO authenticated;

REVOKE ALL ON FUNCTION public.reserve_assigned_job_media(
  uuid,
  public.job_media_kind,
  text,
  bigint
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_assigned_job_media(
  uuid,
  public.job_media_kind,
  text,
  bigint
) TO authenticated;

REVOKE ALL ON FUNCTION public.finalize_assigned_job_media(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_assigned_job_media(uuid)
  TO authenticated;

COMMENT ON TABLE public.job_media IS
  'Private, immutable before/after photos for tenant jobs; storage objects are never public.';
