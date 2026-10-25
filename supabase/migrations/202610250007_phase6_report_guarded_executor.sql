-- CrewFlow Phase 6: guarded execution for approved Report Agent drafts.
-- Saving an approved draft remains separate from publishing, invoicing, and
-- customer communication.

CREATE FUNCTION public.execute_approved_report_draft(target_approval_id uuid)
RETURNS TABLE (
  execution_result text,
  job_id uuid,
  report_id uuid,
  result_message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  approval public.ai_approval_requests%ROWTYPE;
  locked_job public.jobs%ROWTYPE;
  existing_report public.work_reports%ROWTYPE;
  saved_report_id uuid;
  current_work_performed text;
  current_note_count bigint;
  current_before_count bigint;
  current_after_count bigint;
  current_signature_recorded boolean;
  current_state_version text;
  proposed_summary text;
  proposed_work_performed text;
  proposed_parts_used text;
  proposed_recommendations text;
  next_step_number integer;
  rejection_message text;
  has_full_access boolean;
BEGIN
  SELECT request.*
  INTO approval
  FROM public.ai_approval_requests AS request
  WHERE request.id = target_approval_id
  FOR UPDATE;

  IF approval.id IS NULL OR NOT public.current_user_has_tenant_role(
    approval.tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'approval not found or unavailable' USING ERRCODE = '42501';
  END IF;

  IF approval.action_kind <> 'report.save_draft'
    OR approval.target_entity_type <> 'job'
    OR approval.target_entity_id IS NULL THEN
    RAISE EXCEPTION 'approval is not a Report draft save'
      USING ERRCODE = '22023';
  END IF;

  IF approval.status <> 'approved' THEN
    RAISE EXCEPTION 'Report draft save requires an approved request'
      USING ERRCODE = 'P0001';
  END IF;

  IF approval.execution_status IS NOT NULL THEN
    IF approval.execution_status = 'succeeded' THEN
      SELECT report.id
      INTO saved_report_id
      FROM public.work_reports AS report
      WHERE report.tenant_id = approval.tenant_id
        AND report.job_id = approval.target_entity_id
        AND report.status = 'draft'
      ORDER BY report.created_at DESC
      LIMIT 1;
    END IF;

    RETURN QUERY SELECT
      approval.execution_status,
      approval.target_entity_id,
      saved_report_id,
      approval.execution_message;
    RETURN;
  END IF;

  proposed_summary := approval.proposed_changes #>> '{summary,to}';
  proposed_work_performed :=
    approval.proposed_changes #>> '{workPerformed,to}';
  proposed_parts_used := approval.proposed_changes #>> '{partsUsed,to}';
  proposed_recommendations :=
    approval.proposed_changes #>> '{recommendations,to}';

  IF proposed_summary IS NULL
    OR proposed_work_performed IS NULL
    OR char_length(trim(proposed_summary)) NOT BETWEEN 1 AND 5000
    OR char_length(trim(proposed_work_performed)) NOT BETWEEN 1 AND 10000
    OR char_length(coalesce(proposed_parts_used, '')) > 5000
    OR char_length(coalesce(proposed_recommendations, '')) > 5000 THEN
    RAISE EXCEPTION 'Report proposal fields are invalid' USING ERRCODE = '22023';
  END IF;

  SELECT job.*
  INTO locked_job
  FROM public.jobs AS job
  WHERE job.id = approval.target_entity_id
    AND job.tenant_id = approval.tenant_id
  FOR UPDATE;

  SELECT subscription.access_mode = 'full'
  INTO has_full_access
  FROM public.tenant_subscriptions AS subscription
  WHERE subscription.tenant_id = approval.tenant_id;

  IF locked_job.id IS NULL
    OR locked_job.archived_at IS NOT NULL
    OR locked_job.status NOT IN ('completed', 'closed') THEN
    rejection_message :=
      'Job state changed after approval was requested. Create a fresh Report proposal.';

    UPDATE public.ai_approval_requests
    SET execution_status = 'rejected_stale',
        executed_at = now(),
        executed_by_user_id = auth.uid(),
        execution_message = rejection_message
    WHERE id = approval.id;

    SELECT coalesce(max(step.sequence_number), 0) + 1
    INTO next_step_number
    FROM public.ai_run_steps AS step
    WHERE step.run_id = approval.run_id;

    INSERT INTO public.ai_run_steps (
      tenant_id, run_id, sequence_number, step_kind, tool_name,
      redacted_summary, outcome, duration_ms
    ) VALUES (
      approval.tenant_id, approval.run_id, next_step_number,
      'guarded_execution', 'report.save_draft', rejection_message,
      'rejected_stale', 0
    );

    INSERT INTO public.audit_events (
      tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
      approval.tenant_id, auth.uid(), 'ai.report_execution_rejected',
      'job', approval.target_entity_id,
      jsonb_build_object(
        'approval_id', approval.id,
        'run_id', approval.run_id,
        'reason', 'stale_job_state'
      )
    );

    RETURN QUERY SELECT
      'rejected_stale'::text, approval.target_entity_id, NULL::uuid,
      rejection_message;
    RETURN;
  END IF;

  IF NOT coalesce(has_full_access, false) THEN
    rejection_message :=
      'Subscription access is no longer full. The Report draft was not saved.';

    UPDATE public.ai_approval_requests
    SET execution_status = 'rejected_policy',
        executed_at = now(),
        executed_by_user_id = auth.uid(),
        execution_message = rejection_message
    WHERE id = approval.id;

    SELECT coalesce(max(step.sequence_number), 0) + 1
    INTO next_step_number
    FROM public.ai_run_steps AS step
    WHERE step.run_id = approval.run_id;

    INSERT INTO public.ai_run_steps (
      tenant_id, run_id, sequence_number, step_kind, tool_name,
      redacted_summary, outcome, duration_ms
    ) VALUES (
      approval.tenant_id, approval.run_id, next_step_number,
      'guarded_execution', 'report.save_draft', rejection_message,
      'rejected_policy', 0
    );

    INSERT INTO public.audit_events (
      tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
      approval.tenant_id, auth.uid(), 'ai.report_execution_rejected',
      'job', locked_job.id,
      jsonb_build_object(
        'approval_id', approval.id,
        'run_id', approval.run_id,
        'reason', 'subscription_access'
      )
    );

    RETURN QUERY SELECT
      'rejected_policy'::text, locked_job.id, NULL::uuid, rejection_message;
    RETURN;
  END IF;

  SELECT count(*), string_agg(
    format('%s. %s', ordered_note.ordinal, ordered_note.body),
    E'\n' ORDER BY ordered_note.ordinal
  )
  INTO current_note_count, current_work_performed
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

  SELECT
    count(*) FILTER (WHERE media.media_kind = 'before'),
    count(*) FILTER (WHERE media.media_kind = 'after')
  INTO current_before_count, current_after_count
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
  ) INTO current_signature_recorded;

  SELECT report.*
  INTO existing_report
  FROM public.work_reports AS report
  WHERE report.job_id = locked_job.id
    AND report.tenant_id = locked_job.tenant_id
    AND report.status = 'draft'
  FOR UPDATE;

  current_state_version := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        concat_ws(
          '|',
          locked_job.updated_at::text,
          current_work_performed,
          current_before_count::text,
          current_after_count::text,
          current_signature_recorded::text,
          coalesce(existing_report.updated_at::text, 'no-draft')
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  IF current_note_count = 0
    OR char_length(coalesce(current_work_performed, '')) > 10000
    OR current_state_version IS DISTINCT FROM approval.target_state_version
    OR approval.proposed_changes #>> '{summary,from}'
      IS DISTINCT FROM existing_report.summary
    OR approval.proposed_changes #>> '{workPerformed,from}'
      IS DISTINCT FROM existing_report.work_performed
    OR approval.proposed_changes #>> '{partsUsed,from}'
      IS DISTINCT FROM existing_report.parts_used
    OR approval.proposed_changes #>> '{recommendations,from}'
      IS DISTINCT FROM existing_report.recommendations THEN
    rejection_message :=
      'Report evidence or draft changed after approval was requested. Create a fresh Report proposal.';

    UPDATE public.ai_approval_requests
    SET execution_status = 'rejected_stale',
        executed_at = now(),
        executed_by_user_id = auth.uid(),
        execution_message = rejection_message
    WHERE id = approval.id;

    SELECT coalesce(max(step.sequence_number), 0) + 1
    INTO next_step_number
    FROM public.ai_run_steps AS step
    WHERE step.run_id = approval.run_id;

    INSERT INTO public.ai_run_steps (
      tenant_id, run_id, sequence_number, step_kind, tool_name,
      redacted_summary, outcome, duration_ms
    ) VALUES (
      approval.tenant_id, approval.run_id, next_step_number,
      'guarded_execution', 'report.save_draft', rejection_message,
      'rejected_stale', 0
    );

    INSERT INTO public.audit_events (
      tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
      approval.tenant_id, auth.uid(), 'ai.report_execution_rejected',
      'job', locked_job.id,
      jsonb_build_object(
        'approval_id', approval.id,
        'run_id', approval.run_id,
        'reason', 'stale_evidence_or_draft'
      )
    );

    RETURN QUERY SELECT
      'rejected_stale'::text, locked_job.id, NULL::uuid, rejection_message;
    RETURN;
  END IF;

  IF existing_report.id IS NULL THEN
    INSERT INTO public.work_reports (
      tenant_id, job_id, customer_id, summary, work_performed, parts_used,
      recommendations, created_by_user_id
    ) VALUES (
      locked_job.tenant_id, locked_job.id, locked_job.customer_id,
      trim(proposed_summary), trim(proposed_work_performed),
      nullif(trim(coalesce(proposed_parts_used, '')), ''),
      nullif(trim(coalesce(proposed_recommendations, '')), ''), auth.uid()
    ) RETURNING id INTO saved_report_id;
  ELSE
    UPDATE public.work_reports
    SET customer_id = locked_job.customer_id,
        summary = trim(proposed_summary),
        work_performed = trim(proposed_work_performed),
        parts_used = nullif(trim(coalesce(proposed_parts_used, '')), ''),
        recommendations =
          nullif(trim(coalesce(proposed_recommendations, '')), '')
    WHERE id = existing_report.id
    RETURNING id INTO saved_report_id;
  END IF;

  UPDATE public.ai_approval_requests
  SET execution_status = 'succeeded',
      executed_at = now(),
      executed_by_user_id = auth.uid(),
      execution_message =
        'Approved Report draft was saved after current evidence and draft revalidation.'
  WHERE id = approval.id;

  SELECT coalesce(max(step.sequence_number), 0) + 1
  INTO next_step_number
  FROM public.ai_run_steps AS step
  WHERE step.run_id = approval.run_id;

  INSERT INTO public.ai_run_steps (
    tenant_id, run_id, sequence_number, step_kind, tool_name,
    redacted_summary, outcome, duration_ms
  ) VALUES (
    approval.tenant_id, approval.run_id, next_step_number,
    'guarded_execution', 'report.save_draft',
    'Approved editable Report draft saved after role, job state, subscription, evidence-state, and exact-diff checks. It was not published or sent.',
    'succeeded', 0
  );

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    approval.tenant_id, auth.uid(), 'ai.report_executed',
    'work_report', saved_report_id,
    jsonb_build_object(
      'approval_id', approval.id,
      'run_id', approval.run_id,
      'job_id', locked_job.id
    )
  );

  RETURN QUERY SELECT
    'succeeded'::text, locked_job.id, saved_report_id,
    'Approved Report draft saved. Review and publish it separately.'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_approved_report_draft(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_approved_report_draft(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.execute_approved_report_draft(uuid) IS
  'Idempotently saves an approved editable Report draft only after current role, subscription, evidence, exact-diff, and target-state revalidation.';
