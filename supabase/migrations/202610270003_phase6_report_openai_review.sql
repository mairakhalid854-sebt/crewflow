-- CrewFlow Phase 6: audited OpenAI review for deterministic Report proposals.
-- Report and invoice drafting remain exact, approval-required database proposals.

CREATE FUNCTION public.record_report_provider_review(
  target_run_id uuid,
  target_user_id uuid,
  target_policy_version text,
  target_model text,
  target_input_tokens integer,
  target_output_tokens integer,
  target_estimated_cost_cents integer,
  target_duration_ms integer,
  target_redacted_summary text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  locked_run public.ai_agent_runs%ROWTYPE;
  next_sequence integer;
BEGIN
  IF target_run_id IS NULL
    OR target_user_id IS NULL
    OR target_policy_version NOT IN ('report-v1', 'report-invoice-v1')
    OR target_model <> 'gpt-6-luna'
    OR target_input_tokens IS NULL
    OR target_input_tokens NOT BETWEEN 0 AND 4000
    OR target_output_tokens IS NULL
    OR target_output_tokens NOT BETWEEN 0 AND 300
    OR target_estimated_cost_cents IS NULL
    OR target_estimated_cost_cents NOT BETWEEN 0 AND 2
    OR target_duration_ms IS NULL
    OR target_duration_ms NOT BETWEEN 0 AND 30000
    OR target_redacted_summary IS NULL
    OR char_length(target_redacted_summary) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid Report provider review'
      USING ERRCODE = '22023';
  END IF;

  SELECT run.*
  INTO locked_run
  FROM public.ai_agent_runs AS run
  WHERE run.id = target_run_id
    AND run.actor_user_id = target_user_id
    AND run.agent_kind = 'report'
    AND run.policy_version = target_policy_version
    AND run.status IN ('succeeded', 'escalated')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report run is unavailable' USING ERRCODE = '42501';
  END IF;

  IF locked_run.provider = 'openai' AND locked_run.model = target_model THEN
    RETURN false;
  END IF;

  IF locked_run.provider <> 'stub'
    OR locked_run.model <> 'deterministic-v1' THEN
    RAISE EXCEPTION 'Report provider review conflict' USING ERRCODE = '23505';
  END IF;

  UPDATE public.ai_agent_runs
  SET provider = 'openai',
      model = target_model,
      input_tokens = target_input_tokens,
      output_tokens = target_output_tokens,
      estimated_cost_cents = target_estimated_cost_cents,
      duration_ms = target_duration_ms
  WHERE id = locked_run.id;

  SELECT coalesce(max(step.sequence_number), 0) + 1
  INTO next_sequence
  FROM public.ai_run_steps AS step
  WHERE step.run_id = locked_run.id
    AND step.tenant_id = locked_run.tenant_id;

  INSERT INTO public.ai_run_steps (
    tenant_id, run_id, sequence_number, step_kind, redacted_summary,
    outcome, duration_ms
  ) VALUES (
    locked_run.tenant_id, locked_run.id, next_sequence,
    'provider_review', target_redacted_summary, 'provider_reviewed',
    target_duration_ms
  );

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id,
    correlation_id, metadata
  ) VALUES (
    locked_run.tenant_id, target_user_id, 'ai.report_provider_reviewed',
    'ai_agent_run', locked_run.id, locked_run.correlation_id,
    jsonb_build_object(
      'provider', 'openai', 'model', target_model,
      'policy_version', target_policy_version,
      'input_tokens', target_input_tokens,
      'output_tokens', target_output_tokens,
      'estimated_cost_cents', target_estimated_cost_cents,
      'duration_ms', target_duration_ms
    )
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_report_provider_review(
  uuid, uuid, text, text, integer, integer, integer, integer, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_report_provider_review(
  uuid, uuid, text, text, integer, integer, integer, integer, text
) TO service_role;

COMMENT ON FUNCTION public.record_report_provider_review(
  uuid, uuid, text, text, integer, integer, integer, integer, text
) IS
  'Service-role-only bounded usage and trace recorder for authorized deterministic Report and Report-invoice runs.';
