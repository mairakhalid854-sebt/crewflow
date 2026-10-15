-- CrewFlow Phase 3: reviewed customer work reports with tenant-safe drafts
-- and token-scoped public views. Raw public tokens are never stored.

CREATE TYPE public.work_report_status AS ENUM ('draft', 'sent', 'void');

CREATE TABLE public.work_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  status public.work_report_status NOT NULL DEFAULT 'draft',
  summary text NOT NULL,
  work_performed text NOT NULL,
  parts_used text,
  recommendations text,
  public_token_hash text UNIQUE,
  approved_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  sent_at timestamptz,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_reports_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT work_reports_job_tenant_fk FOREIGN KEY (job_id, tenant_id)
    REFERENCES public.jobs(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT work_reports_customer_tenant_fk FOREIGN KEY (customer_id, tenant_id)
    REFERENCES public.customers(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT work_reports_summary_length CHECK (
    char_length(trim(summary)) BETWEEN 1 AND 5000
  ),
  CONSTRAINT work_reports_work_performed_length CHECK (
    char_length(trim(work_performed)) BETWEEN 1 AND 10000
  ),
  CONSTRAINT work_reports_parts_used_length CHECK (
    parts_used IS NULL OR char_length(parts_used) <= 5000
  ),
  CONSTRAINT work_reports_recommendations_length CHECK (
    recommendations IS NULL OR char_length(recommendations) <= 5000
  ),
  CONSTRAINT work_reports_token_hash_format CHECK (
    public_token_hash IS NULL OR public_token_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT work_reports_sent_state CHECK (
    (status = 'draft' AND public_token_hash IS NULL
      AND approved_at IS NULL AND sent_at IS NULL)
    OR (status IN ('sent', 'void') AND public_token_hash IS NOT NULL
      AND approved_at IS NOT NULL AND sent_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX work_reports_one_draft_per_job_idx
  ON public.work_reports (job_id) WHERE status = 'draft';
CREATE INDEX work_reports_tenant_job_created_idx
  ON public.work_reports (tenant_id, job_id, created_at DESC);

CREATE TRIGGER work_reports_updated_at
BEFORE UPDATE ON public.work_reports
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER work_reports_tenant_immutable
BEFORE UPDATE ON public.work_reports
FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_change();

ALTER TABLE public.work_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY work_reports_read_office ON public.work_reports
FOR SELECT TO authenticated USING (
  public.current_user_has_tenant_role(
    tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  )
);

REVOKE ALL ON public.work_reports FROM anon, authenticated;
GRANT SELECT ON public.work_reports TO authenticated;

CREATE FUNCTION public.save_job_work_report(
  target_job_id uuid,
  report_summary text,
  report_work_performed text,
  report_parts_used text,
  report_recommendations text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  draft_report_id uuid;
  report_customer_id uuid;
  report_tenant_id uuid;
BEGIN
  IF report_summary IS NULL
    OR report_work_performed IS NULL
    OR char_length(trim(report_summary)) NOT BETWEEN 1 AND 5000
    OR char_length(trim(report_work_performed)) NOT BETWEEN 1 AND 10000
    OR char_length(coalesce(report_parts_used, '')) > 5000
    OR char_length(coalesce(report_recommendations, '')) > 5000
  THEN
    RAISE EXCEPTION 'work report fields are invalid' USING ERRCODE = '22023';
  END IF;

  SELECT job.tenant_id, job.customer_id
  INTO report_tenant_id, report_customer_id
  FROM public.jobs AS job
  WHERE job.id = target_job_id
    AND job.archived_at IS NULL
    AND job.status IN ('completed', 'closed')
  FOR UPDATE;

  IF report_tenant_id IS NULL OR NOT public.current_user_has_tenant_role(
    report_tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'job is unavailable for work reporting' USING ERRCODE = '42501';
  END IF;

  SELECT report.id
  INTO draft_report_id
  FROM public.work_reports AS report
  WHERE report.job_id = target_job_id AND report.status = 'draft'
  FOR UPDATE;

  IF draft_report_id IS NULL THEN
    INSERT INTO public.work_reports (
      tenant_id,
      job_id,
      customer_id,
      summary,
      work_performed,
      parts_used,
      recommendations,
      created_by_user_id
    ) VALUES (
      report_tenant_id,
      target_job_id,
      report_customer_id,
      trim(report_summary),
      trim(report_work_performed),
      nullif(trim(report_parts_used), ''),
      nullif(trim(report_recommendations), ''),
      auth.uid()
    )
    RETURNING id INTO draft_report_id;
  ELSE
    UPDATE public.work_reports
    SET customer_id = report_customer_id,
        summary = trim(report_summary),
        work_performed = trim(report_work_performed),
        parts_used = nullif(trim(report_parts_used), ''),
        recommendations = nullif(trim(report_recommendations), '')
    WHERE id = draft_report_id;
  END IF;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    report_tenant_id,
    auth.uid(),
    'report.saved',
    'work_report',
    draft_report_id,
    jsonb_build_object('job_id', target_job_id)
  );

  RETURN draft_report_id;
END;
$$;

CREATE FUNCTION public.publish_job_work_report(target_report_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  generated_token text;
  report_job_id uuid;
  report_tenant_id uuid;
BEGIN
  SELECT report.tenant_id, report.job_id
  INTO report_tenant_id, report_job_id
  FROM public.work_reports AS report
  JOIN public.jobs AS job
    ON job.id = report.job_id AND job.tenant_id = report.tenant_id
  WHERE report.id = target_report_id
    AND report.status = 'draft'
    AND job.archived_at IS NULL
    AND job.status IN ('completed', 'closed')
  FOR UPDATE OF report;

  IF report_tenant_id IS NULL OR NOT public.current_user_has_tenant_role(
    report_tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'draft work report is unavailable' USING ERRCODE = '42501';
  END IF;

  generated_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');

  UPDATE public.work_reports
  SET status = 'void'
  WHERE job_id = report_job_id
    AND tenant_id = report_tenant_id
    AND status = 'sent';

  UPDATE public.work_reports
  SET status = 'sent',
      approved_by_user_id = auth.uid(),
      approved_at = now(),
      sent_at = now(),
      public_token_hash = pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(generated_token, 'UTF8'), 'sha256'),
        'hex'
      )
  WHERE id = target_report_id;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    report_tenant_id,
    auth.uid(),
    'report.approved_sent',
    'work_report',
    target_report_id,
    jsonb_build_object('job_id', report_job_id)
  );

  RETURN generated_token;
END;
$$;

CREATE FUNCTION public.get_public_work_report(report_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'report_id', report.id,
    'company_name', tenant.display_name,
    'customer_name', trim(customer.first_name || ' ' || customer.last_name),
    'job_title', job.title,
    'scheduled_start_at', job.scheduled_start_at,
    'scheduled_end_at', job.scheduled_end_at,
    'summary', report.summary,
    'work_performed', report.work_performed,
    'parts_used', report.parts_used,
    'recommendations', report.recommendations,
    'approved_at', report.approved_at,
    'sent_at', report.sent_at
  )
  FROM public.work_reports AS report
  JOIN public.tenants AS tenant ON tenant.id = report.tenant_id
  JOIN public.customers AS customer
    ON customer.id = report.customer_id AND customer.tenant_id = report.tenant_id
  JOIN public.jobs AS job
    ON job.id = report.job_id AND job.tenant_id = report.tenant_id
  WHERE report_token ~ '^[0-9a-f]{64}$'
    AND report.public_token_hash = pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(report_token, 'UTF8'), 'sha256'),
      'hex'
    )
    AND report.status = 'sent';
$$;

REVOKE ALL ON FUNCTION public.save_job_work_report(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_job_work_report(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_work_report(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.save_job_work_report(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_job_work_report(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_work_report(text) TO anon, authenticated;

COMMENT ON TABLE public.work_reports IS
  'Reviewed tenant work-report snapshots with token-hashed customer access; raw tokens are never stored.';
