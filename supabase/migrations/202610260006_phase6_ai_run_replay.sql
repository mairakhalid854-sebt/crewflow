-- CrewFlow Phase 6: authorized deterministic replay with immutable provenance.
-- Replay always re-enters the current proposal policy with a fresh correlation;
-- it never reuses an old approval to execute a business mutation.

CREATE TABLE public.ai_run_replays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  source_run_id uuid NOT NULL,
  replay_run_id uuid NOT NULL,
  requested_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  requested_correlation_id uuid NOT NULL,
  action_kind text NOT NULL,
  target_entity_type text NOT NULL,
  target_entity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_run_replays_source_tenant_fk
    FOREIGN KEY (source_run_id, tenant_id)
    REFERENCES public.ai_agent_runs(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT ai_run_replays_replay_tenant_fk
    FOREIGN KEY (replay_run_id, tenant_id)
    REFERENCES public.ai_agent_runs(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT ai_run_replays_source_correlation_unique
    UNIQUE (source_run_id, requested_correlation_id),
  CONSTRAINT ai_run_replays_distinct_runs CHECK (source_run_id <> replay_run_id),
  CONSTRAINT ai_run_replays_action_length
    CHECK (char_length(action_kind) BETWEEN 3 AND 120),
  CONSTRAINT ai_run_replays_target_type_length
    CHECK (char_length(target_entity_type) BETWEEN 3 AND 80)
);

CREATE INDEX ai_run_replays_tenant_created_idx
  ON public.ai_run_replays (tenant_id, created_at DESC);
CREATE INDEX ai_run_replays_replay_run_idx
  ON public.ai_run_replays (replay_run_id);

CREATE TRIGGER ai_run_replays_immutable
BEFORE UPDATE OR DELETE ON public.ai_run_replays
FOR EACH ROW EXECUTE FUNCTION public.reject_ai_trace_mutation();

ALTER TABLE public.ai_run_replays ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_run_replays_read_office
ON public.ai_run_replays
FOR SELECT TO authenticated USING (
  public.current_user_has_tenant_role(
    tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  )
);
REVOKE ALL ON public.ai_run_replays FROM anon, authenticated;
GRANT SELECT ON public.ai_run_replays TO authenticated;

CREATE FUNCTION public.replay_ai_agent_run(
  target_source_run_id uuid,
  target_correlation_id uuid
)
RETURNS TABLE (
  replay_run_id uuid,
  approval_id uuid,
  replay_result text,
  result_message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  source_run public.ai_agent_runs%ROWTYPE;
  source_approval public.ai_approval_requests%ROWTYPE;
  actor public.memberships%ROWTYPE;
  produced_run_id uuid;
  produced_approval_id uuid;
  produced_result text;
  produced_message text;
  existing_replay public.ai_run_replays%ROWTYPE;
BEGIN
  SELECT run.* INTO source_run
  FROM public.ai_agent_runs AS run
  WHERE run.id = target_source_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI run not found or unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT membership.* INTO actor
  FROM public.memberships AS membership
  WHERE membership.tenant_id = source_run.tenant_id
    AND membership.user_id = auth.uid()
    AND membership.status = 'active'
    AND membership.role IN ('owner', 'office');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI run not found or unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT request.* INTO source_approval
  FROM public.ai_approval_requests AS request
  WHERE request.run_id = source_run.id
    AND request.tenant_id = source_run.tenant_id
  ORDER BY request.created_at DESC
  LIMIT 1;
  IF NOT FOUND OR source_approval.target_entity_id IS NULL
    OR source_approval.target_entity_type IS NULL THEN
    RAISE EXCEPTION 'this run has no replayable target' USING ERRCODE = '22023';
  END IF;
  IF source_approval.status = 'pending' THEN
    RAISE EXCEPTION 'pending run cannot be replayed' USING ERRCODE = 'P0001';
  END IF;

  SELECT replay.* INTO existing_replay
  FROM public.ai_run_replays AS replay
  WHERE replay.source_run_id = source_run.id
    AND replay.requested_correlation_id = target_correlation_id;
  IF FOUND THEN
    SELECT request.id INTO produced_approval_id
    FROM public.ai_approval_requests AS request
    WHERE request.tenant_id = source_run.tenant_id
      AND request.run_id = existing_replay.replay_run_id
    ORDER BY request.created_at DESC
    LIMIT 1;

    SELECT run.status::text INTO produced_result
    FROM public.ai_agent_runs AS run
    WHERE run.id = existing_replay.replay_run_id
      AND run.tenant_id = source_run.tenant_id;

    RETURN QUERY SELECT existing_replay.replay_run_id, produced_approval_id,
      produced_result, 'Existing replay returned.'::text;
    RETURN;
  END IF;

  CASE source_approval.action_kind
    WHEN 'dispatcher.assign_technician' THEN
      SELECT result.run_id, result.approval_id, result.proposal_result,
             result.result_message
      INTO produced_run_id, produced_approval_id, produced_result,
           produced_message
      FROM public.request_dispatcher_proposal(
        source_approval.target_entity_id, target_correlation_id
      ) AS result;
    WHEN 'report.save_draft' THEN
      SELECT result.run_id, result.approval_id, result.proposal_result,
             result.result_message
      INTO produced_run_id, produced_approval_id, produced_result,
           produced_message
      FROM public.request_report_proposal(
        source_approval.target_entity_id, target_correlation_id
      ) AS result;
    WHEN 'report.save_invoice_draft' THEN
      SELECT result.run_id, result.approval_id, result.proposal_result,
             result.result_message
      INTO produced_run_id, produced_approval_id, produced_result,
           produced_message
      FROM public.request_report_invoice_proposal(
        source_approval.target_entity_id, target_correlation_id
      ) AS result;
    WHEN 'intake.create_draft_records' THEN
      SELECT result.run_id, result.approval_id, result.proposal_result,
             result.result_message
      INTO produced_run_id, produced_approval_id, produced_result,
           produced_message
      FROM public.request_intake_quote_slot_proposal(
        source_approval.target_entity_id, target_correlation_id
      ) AS result;
    ELSE
      RAISE EXCEPTION 'this agent action does not support replay'
        USING ERRCODE = '22023';
  END CASE;

  IF produced_run_id IS NULL OR produced_run_id = source_run.id THEN
    RAISE EXCEPTION 'replay did not produce distinct governed evidence'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.ai_run_replays (
    tenant_id, source_run_id, replay_run_id, requested_by_user_id,
    requested_correlation_id, action_kind, target_entity_type, target_entity_id
  ) VALUES (
    source_run.tenant_id, source_run.id, produced_run_id, auth.uid(),
    target_correlation_id, source_approval.action_kind,
    source_approval.target_entity_type, source_approval.target_entity_id
  );

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    source_run.tenant_id, auth.uid(), 'ai.run_replayed',
    'ai_agent_run', produced_run_id,
    jsonb_build_object(
      'source_run_id', source_run.id,
      'action_kind', source_approval.action_kind,
      'target_entity_type', source_approval.target_entity_type,
      'target_entity_id', source_approval.target_entity_id,
      'replay_result', produced_result
    )
  );

  RETURN QUERY SELECT produced_run_id, produced_approval_id,
    produced_result, produced_message;
END;
$$;

REVOKE ALL ON FUNCTION public.replay_ai_agent_run(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replay_ai_agent_run(uuid, uuid)
  TO authenticated;

COMMENT ON TABLE public.ai_run_replays IS
  'Immutable provenance linking a closed governed run to a fresh current-policy proposal evaluation.';
COMMENT ON FUNCTION public.replay_ai_agent_run(uuid, uuid) IS
  'Re-enters a supported current deterministic proposal policy with fresh correlation, role/budget checks, and no direct execution.';
