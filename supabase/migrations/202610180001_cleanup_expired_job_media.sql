-- CrewFlow Phase 4: claim and clean abandoned photo reservations safely.
-- Physical objects are removed by the cleanup-job-media Edge Function through
-- the Storage API before the matching metadata rows are deleted.

ALTER TABLE public.job_media
ADD COLUMN cleanup_claimed_at timestamptz;

CREATE INDEX job_media_expired_cleanup_idx
  ON public.job_media (created_at, id)
  WHERE uploaded_at IS NULL;

CREATE FUNCTION public.guard_claimed_job_media_finalization()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.uploaded_at IS NULL
    AND NEW.uploaded_at IS NOT NULL
    AND OLD.cleanup_claimed_at IS NOT NULL THEN
    RAISE EXCEPTION 'job photo reservation is being cleaned up'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_claimed_job_media_finalization
BEFORE UPDATE OF uploaded_at ON public.job_media
FOR EACH ROW
EXECUTE FUNCTION public.guard_claimed_job_media_finalization();

CREATE FUNCTION public.claim_expired_job_media_cleanup(batch_size integer DEFAULT 100)
RETURNS TABLE (media_id uuid, storage_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF batch_size NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'cleanup batch size must be between 1 and 500'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT media.id
    FROM public.job_media AS media
    WHERE media.uploaded_at IS NULL
      AND media.created_at <= now() - interval '7 days'
      AND (
        media.cleanup_claimed_at IS NULL
        OR media.cleanup_claimed_at <= now() - interval '15 minutes'
      )
    ORDER BY media.created_at, media.id
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.job_media AS media
  SET cleanup_claimed_at = now()
  FROM candidates
  WHERE media.id = candidates.id
  RETURNING media.id, media.storage_path;
END;
$$;

CREATE FUNCTION public.complete_expired_job_media_cleanup(target_media_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  deleted_count integer;
BEGIN
  IF target_media_ids IS NULL
    OR cardinality(target_media_ids) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'cleanup media ids must contain between 1 and 500 items'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.job_media AS media
  WHERE media.id = ANY(target_media_ids)
    AND media.uploaded_at IS NULL
    AND media.cleanup_claimed_at IS NOT NULL;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_claimed_job_media_finalization()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.claim_expired_job_media_cleanup(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_expired_job_media_cleanup(integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.complete_expired_job_media_cleanup(uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_expired_job_media_cleanup(uuid[])
  TO service_role;

COMMENT ON COLUMN public.job_media.cleanup_claimed_at IS
  'Server-side cleanup lease for abandoned, unfinalized media reservations.';
COMMENT ON FUNCTION public.claim_expired_job_media_cleanup(integer) IS
  'Claims at most 500 unfinalized media reservations older than seven days for Storage API cleanup.';
COMMENT ON FUNCTION public.complete_expired_job_media_cleanup(uuid[]) IS
  'Deletes claimed reservation metadata after the Edge Function removes the physical objects.';
