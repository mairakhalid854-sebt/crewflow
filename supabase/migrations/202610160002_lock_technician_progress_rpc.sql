-- Supabase projects may retain an explicit anon function grant independently
-- from PUBLIC defaults. Deny anonymous execution of the authenticated field
-- progress command explicitly.

REVOKE EXECUTE ON FUNCTION public.advance_assigned_job(
  uuid,
  public.job_status,
  text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.advance_assigned_job(
  uuid,
  public.job_status,
  text
) TO authenticated;
