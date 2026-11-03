-- CrewFlow Phase 6: authoritative deterministic Report Agent orchestration.
-- This RPC records a governed draft proposal but never saves, publishes,
-- invoices, or sends a customer communication.

CREATE FUNCTION public.request_report_proposal(
  target_job_id uuid,
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
  locked_job public.jobs%ROWTYPE;
  actor_membership public.memberships%ROWTYPE;
  existing_run public.ai_agent_runs%ROWTYPE;
  existing_approval_id uuid;
  existing_report public.work_reports%ROWTYPE;
  new_run_id uuid;
  new_approval_id uuid;
  service_name text;
  normalized_title text;
  report_summary text;
  report_work_performed text;
  report_parts_used text :=
    'Unknown - no structured parts-used record was supplied.';
  report_recommendations text :=
    'Unknown - no structured technician recommendation was supplied.';
  proposed_changes jsonb;
  evidence_state_version text;
  technician_note_count bigint;
  before_photo_count bigint;
  after_photo_count bigint;
  signature_recorded boolean;
  run_summary text;
  ai_enabled boolean;
  tenant_budget integer;
  plan_budget bigint;
  effective_budget bigint;
  spent_this_month bigint;
BEGIN
  SELECT job.*
  INTO locked_job
  FROM public.jobs AS job
  WHERE job.id = target_job_id
    AND job.archived_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found or unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT membership.*
  INTO actor_membership
  FROM public.memberships AS membership
  WHERE membership.tenant_id = locked_job.tenant_id
    AND membership.user_id = auth.uid()
    AND membership.status = 'active'
    AND membership.role IN ('owner', 'office');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active office membership required' USING ERRCODE = '42501';
  END IF;

  IF locked_job.status NOT IN ('completed', 'closed') THEN
    RAISE EXCEPTION 'job must be completed or closed for report drafting'
      USING ERRCODE = '22023';
  END IF;

  run_summary := concat('Report draft evaluation for job ', locked_job.id);

  SELECT run.*
  INTO existing_run
  FROM public.ai_agent_runs AS run
  WHERE run.tenant_id = locked_job.tenant_id
    AND run.correlation_id = target_correlation_id;

  IF FOUND THEN
    IF existing_run.actor_user_id IS DISTINCT FROM auth.uid()
      OR existing_run.agent_kind <> 'report'
      OR existing_run.policy_version <> 'report-v1'
      OR existing_run.redacted_input_summary <> run_summary THEN
      RAISE EXCEPTION 'AI correlation payload conflict' USING ERRCODE = '23505';
    END IF;

    SELECT approval.id
    INTO existing_approval_id
    FROM public.ai_approval_requests AS approval
    WHERE approval.run_id = existing_run.id
      AND approval.tenant_id = existing_run.tenant_id
    LIMIT 1;

    RETURN QUERY SELECT
      existing_run.id,
      existing_approval_id,
      CASE
        WHEN existing_approval_id IS NOT NULL THEN 'proposed'
        WHEN existing_run.status = 'escalated' THEN 'escalated'
        ELSE 'unchanged'
      END,
      'Existing Report evaluation returned.'::text;
    RETURN;
  END IF;

  SELECT settings.ai_operations_enabled, settings.ai_monthly_budget_cents
  INTO ai_enabled, tenant_budget
  FROM public.tenant_settings AS settings
  WHERE settings.tenant_id = locked_job.tenant_id;

  IF NOT coalesce(ai_enabled, false) THEN
    RAISE EXCEPTION 'AI operations are disabled' USING ERRCODE = '42501';
  END IF;

  SELECT plan.ai_monthly_budget_cents
  INTO plan_budget
  FROM public.tenant_subscriptions AS subscription
  JOIN public.billing_plans AS plan ON plan.code = subscription.plan_code
  WHERE subscription.tenant_id = locked_job.tenant_id;

  effective_budget := CASE
    WHEN plan_budget IS NULL THEN tenant_budget
    ELSE least(tenant_budget::bigint, plan_budget)
  END;

  SELECT coalesce(sum(run.estimated_cost_cents), 0)
  INTO spent_this_month
  FROM public.ai_agent_runs AS run
  WHERE run.tenant_id = locked_job.tenant_id
    AND run.created_at >= date_trunc('month', now());

  IF effective_budget <= spent_this_month THEN
    RAISE EXCEPTION 'AI monthly budget exhausted' USING ERRCODE = 'P0001';
  END IF;

  SELECT service.name
  INTO service_name
  FROM public.services AS service
  WHERE service.id = locked_job.service_id
    AND service.tenant_id = locked_job.tenant_id;

  normalized_title := regexp_replace(trim(locked_job.title), '[[:space:]]+', ' ', 'g');
  service_name := nullif(
    regexp_replace(trim(coalesce(service_name, '')), '[[:space:]]+', ' ', 'g'),
    ''
  );

  SELECT count(*), string_agg(
    format('%s. %s', ordered_note.ordinal, ordered_note.body),
    E'\n' ORDER BY ordered_note.ordinal
  )
  INTO technician_note_count, report_work_performed
  FROM (
    SELECT
      row_number() OVER (
        ORDER BY note.created_at, note.id
      ) AS ordinal,
      regexp_replace(trim(note.body), '[[:space:]]+', ' ', 'g') AS body
    FROM public.job_work_notes AS note
    WHERE note.job_id = locked_job.id
      AND note.tenant_id = locked_job.tenant_id
  ) AS ordered_note;

  IF technician_note_count = 0 THEN
    INSERT INTO public.ai_agent_runs (
      tenant_id, actor_user_id, agent_kind, policy_version, correlation_id,
      status, redacted_input_summary, completed_at
    ) VALUES (
      locked_job.tenant_id, auth.uid(), 'report', 'report-v1',
      target_correlation_id, 'escalated', run_summary, now()
    ) RETURNING id INTO new_run_id;

    INSERT INTO public.ai_run_steps (
      tenant_id, run_id, sequence_number, step_kind, redacted_summary,
      outcome, duration_ms
    ) VALUES (
      locked_job.tenant_id, new_run_id, 1, 'evidence_validation',
      'No valid technician work notes were available; a person must draft the report.',
      'escalated', 0
    );

    INSERT INTO public.audit_events (
      tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
      locked_job.tenant_id, auth.uid(), 'ai.report_escalated',
      'job', locked_job.id,
      jsonb_build_object('run_id', new_run_id, 'reason', 'missing_notes')
    );

    RETURN QUERY SELECT
      new_run_id, NULL::uuid, 'escalated'::text,
      'No technician work notes are available. Draft the report manually.'::text;
    RETURN;
  END IF;

  IF char_length(report_work_performed) > 10000 THEN
    INSERT INTO public.ai_agent_runs (
      tenant_id, actor_user_id, agent_kind, policy_version, correlation_id,
      status, redacted_input_summary, completed_at
    ) VALUES (
      locked_job.tenant_id, auth.uid(), 'report', 'report-v1',
      target_correlation_id, 'escalated', run_summary, now()
    ) RETURNING id INTO new_run_id;

    INSERT INTO public.ai_run_steps (
      tenant_id, run_id, sequence_number, step_kind, redacted_summary,
      outcome, duration_ms
    ) VALUES (
      locked_job.tenant_id, new_run_id, 1, 'evidence_validation',
      'Technician notes exceeded the safe draft limit; a person must summarize them.',
      'escalated', 0
    );

    INSERT INTO public.audit_events (
      tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
      locked_job.tenant_id, auth.uid(), 'ai.report_escalated',
      'job', locked_job.id,
      jsonb_build_object('run_id', new_run_id, 'reason', 'oversized_notes')
    );

    RETURN QUERY SELECT
      new_run_id, NULL::uuid, 'escalated'::text,
      'Technician notes need a manual summary before report drafting.'::text;
    RETURN;
  END IF;

  SELECT
    count(*) FILTER (WHERE media.media_kind = 'before'),
    count(*) FILTER (WHERE media.media_kind = 'after')
  INTO before_photo_count, after_photo_count
  FROM public.job_media AS media
  WHERE media.job_id = locked_job.id
    AND media.tenant_id = locked_job.tenant_id
    AND media.uploaded_at IS NOT NULL;

  SELECT EXISTS (
    SELECT 1
    FROM public.job_signatures AS signature
    WHERE signature.job_id = locked_job.id
      AND signature.tenant_id = locked_job.tenant_id
      AND signature.signed_at IS NOT NULL
  ) INTO signature_recorded;

  SELECT report.*
  INTO existing_report
  FROM public.work_reports AS report
  WHERE report.job_id = locked_job.id
    AND report.tenant_id = locked_job.tenant_id
    AND report.status = 'draft'
  LIMIT 1;

  report_summary := CASE
    WHEN service_name IS NULL THEN format(
      'Work for "%s" was recorded as %s.',
      normalized_title, locked_job.status::text
    )
    ELSE format(
      '%s work for "%s" was recorded as %s.',
      service_name, normalized_title, locked_job.status::text
    )
  END;

  proposed_changes := jsonb_build_object(
    'summary', jsonb_build_object(
      'from', existing_report.summary,
      'to', report_summary
    ),
    'workPerformed', jsonb_build_object(
      'from', existing_report.work_performed,
      'to', report_work_performed
    ),
    'partsUsed', jsonb_build_object(
      'from', existing_report.parts_used,
      'to', report_parts_used
    ),
    'recommendations', jsonb_build_object(
      'from', existing_report.recommendations,
      'to', report_recommendations
    )
  );

  IF octet_length(proposed_changes::text) > 20000 THEN
    RAISE EXCEPTION 'report proposal exceeds the governed approval limit'
      USING ERRCODE = '22023';
  END IF;

  evidence_state_version := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        concat_ws(
          '|',
          locked_job.updated_at::text,
          report_work_performed,
          before_photo_count::text,
          after_photo_count::text,
          signature_recorded::text,
          coalesce(existing_report.updated_at::text, 'no-draft')
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.ai_agent_runs (
    tenant_id, actor_user_id, agent_kind, policy_version, correlation_id,
    status, redacted_input_summary, completed_at
  ) VALUES (
    locked_job.tenant_id, auth.uid(), 'report', 'report-v1',
    target_correlation_id, 'succeeded', run_summary, now()
  ) RETURNING id INTO new_run_id;

  INSERT INTO public.ai_run_steps (
    tenant_id, run_id, sequence_number, step_kind, redacted_summary,
    outcome, duration_ms
  ) VALUES (
    locked_job.tenant_id, new_run_id, 1, 'evidence_validation',
    format(
      'Grounded draft in %s technician notes, %s uploaded before photos, %s uploaded after photos, and signature recorded: %s. Image contents were not interpreted.',
      technician_note_count, before_photo_count, after_photo_count,
      signature_recorded
    ),
    'grounded', 0
  );

  SELECT approval.id
  INTO existing_approval_id
  FROM public.ai_approval_requests AS approval
  WHERE approval.tenant_id = locked_job.tenant_id
    AND approval.action_kind = 'report.save_draft'
    AND approval.target_entity_type = 'job'
    AND approval.target_entity_id = locked_job.id
    AND approval.target_state_version = evidence_state_version
    AND approval.status = 'pending'
    AND approval.expires_at > now()
  ORDER BY approval.created_at DESC
  LIMIT 1;

  IF existing_approval_id IS NOT NULL THEN
    RETURN QUERY SELECT
      new_run_id, existing_approval_id, 'proposed'::text,
      'A current Report approval already exists for this evidence state.'::text;
    RETURN;
  END IF;

  INSERT INTO public.ai_approval_requests (
    tenant_id, run_id, action_kind, rationale, proposed_changes,
    consequences, target_entity_type, target_entity_id,
    target_state_version, requested_by_user_id
  ) VALUES (
    locked_job.tenant_id,
    new_run_id,
    'report.save_draft',
    format(
      'Drafted from %s ordered technician notes. Counted %s before and %s after photos without interpreting image contents. Signature recorded: %s. Parts and recommendations remain explicitly unknown.',
      technician_note_count, before_photo_count, after_photo_count,
      signature_recorded
    ),
    proposed_changes,
    'Approval may save or replace the editable office draft only. It cannot publish the report, create or send an invoice, or contact the customer. Execution must revalidate the evidence state.',
    'job',
    locked_job.id,
    evidence_state_version,
    auth.uid()
  ) RETURNING id INTO new_approval_id;

  INSERT INTO public.ai_run_steps (
    tenant_id, run_id, sequence_number, step_kind, tool_name,
    redacted_summary, outcome, duration_ms
  ) VALUES (
    locked_job.tenant_id, new_run_id, 2, 'approval_requested',
    'report.save_draft',
    'Created mandatory office approval for an editable report draft; no report was saved or published.',
    'pending_approval', 0
  );

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    locked_job.tenant_id, auth.uid(), 'ai.report_proposed',
    'job', locked_job.id,
    jsonb_build_object(
      'run_id', new_run_id,
      'approval_id', new_approval_id,
      'technician_note_count', technician_note_count,
      'before_photo_count', before_photo_count,
      'after_photo_count', after_photo_count,
      'signature_recorded', signature_recorded
    )
  );

  RETURN QUERY SELECT
    new_run_id, new_approval_id, 'proposed'::text,
    'Report draft proposal created for office review.'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.request_report_proposal(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_report_proposal(uuid, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.request_report_proposal(uuid, uuid) IS
  'Creates a tenant-authorized evidence-bounded Report run and approval; never saves, publishes, invoices, or sends.';
