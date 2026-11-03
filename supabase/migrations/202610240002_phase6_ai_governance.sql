-- CrewFlow Phase 6: provider-neutral AI governance foundation.
-- No live model/provider is enabled here. The only provider is a deterministic
-- stub so budgets, traces, approvals, and tenant isolation can be tested safely.

CREATE TYPE public.ai_agent_kind AS ENUM (
  'intake',
  'dispatcher',
  'report',
  'follow_up'
);
CREATE TYPE public.ai_run_status AS ENUM (
  'queued',
  'running',
  'succeeded',
  'failed',
  'escalated',
  'budget_blocked'
);
CREATE TYPE public.ai_approval_status AS ENUM (
  'pending',
  'approved',
  'rejected',
  'expired'
);

CREATE TABLE public.ai_agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  agent_kind public.ai_agent_kind NOT NULL,
  provider text NOT NULL DEFAULT 'stub',
  model text NOT NULL DEFAULT 'deterministic-v1',
  policy_version text NOT NULL,
  correlation_id uuid NOT NULL,
  status public.ai_run_status NOT NULL DEFAULT 'queued',
  redacted_input_summary text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_cents integer NOT NULL DEFAULT 0,
  duration_ms integer,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT ai_agent_runs_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT ai_agent_runs_stub_only CHECK (
    provider = 'stub' AND model = 'deterministic-v1'
  ),
  CONSTRAINT ai_agent_runs_policy_length CHECK (
    char_length(policy_version) BETWEEN 1 AND 80
  ),
  CONSTRAINT ai_agent_runs_summary_length CHECK (
    char_length(redacted_input_summary) BETWEEN 1 AND 2000
  ),
  CONSTRAINT ai_agent_runs_usage_bounds CHECK (
    input_tokens BETWEEN 0 AND 10000000
    AND output_tokens BETWEEN 0 AND 10000000
    AND estimated_cost_cents BETWEEN 0 AND 100000000
    AND (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 86400000)
  ),
  CONSTRAINT ai_agent_runs_error_shape CHECK (
    (status = 'failed' AND error_code IS NOT NULL)
    OR (status <> 'failed' AND error_code IS NULL)
  ),
  CONSTRAINT ai_agent_runs_error_length CHECK (
    error_code IS NULL OR char_length(error_code) <= 80
  ),
  CONSTRAINT ai_agent_runs_completion_shape CHECK (
    (status IN ('queued', 'running') AND completed_at IS NULL)
    OR (status NOT IN ('queued', 'running') AND completed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX ai_agent_runs_tenant_correlation_unique
  ON public.ai_agent_runs (tenant_id, correlation_id);
CREATE INDEX ai_agent_runs_tenant_created_idx
  ON public.ai_agent_runs (tenant_id, created_at DESC);

CREATE TABLE public.ai_run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL,
  sequence_number integer NOT NULL,
  step_kind text NOT NULL,
  tool_name text,
  redacted_summary text NOT NULL,
  outcome text NOT NULL,
  duration_ms integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_run_steps_run_tenant_fk
    FOREIGN KEY (run_id, tenant_id)
    REFERENCES public.ai_agent_runs(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT ai_run_steps_sequence_unique UNIQUE (run_id, sequence_number),
  CONSTRAINT ai_run_steps_sequence_bounds CHECK (
    sequence_number BETWEEN 1 AND 1000
  ),
  CONSTRAINT ai_run_steps_kind_length CHECK (
    char_length(step_kind) BETWEEN 1 AND 80
  ),
  CONSTRAINT ai_run_steps_tool_length CHECK (
    tool_name IS NULL OR char_length(tool_name) BETWEEN 1 AND 120
  ),
  CONSTRAINT ai_run_steps_summary_length CHECK (
    char_length(redacted_summary) BETWEEN 1 AND 4000
  ),
  CONSTRAINT ai_run_steps_outcome_length CHECK (
    char_length(outcome) BETWEEN 1 AND 80
  ),
  CONSTRAINT ai_run_steps_duration_bounds CHECK (
    duration_ms BETWEEN 0 AND 86400000
  )
);

CREATE TABLE public.ai_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL,
  action_kind text NOT NULL,
  rationale text NOT NULL,
  proposed_changes jsonb NOT NULL,
  consequences text NOT NULL,
  target_entity_type text,
  target_entity_id uuid,
  target_state_version text,
  status public.ai_approval_status NOT NULL DEFAULT 'pending',
  requested_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '48 hours'),
  decided_at timestamptz,
  decision_reason text,
  CONSTRAINT ai_approval_requests_run_tenant_fk
    FOREIGN KEY (run_id, tenant_id)
    REFERENCES public.ai_agent_runs(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT ai_approval_requests_action_length CHECK (
    char_length(action_kind) BETWEEN 3 AND 120
  ),
  CONSTRAINT ai_approval_requests_rationale_length CHECK (
    char_length(rationale) BETWEEN 3 AND 4000
  ),
  CONSTRAINT ai_approval_requests_changes_shape CHECK (
    jsonb_typeof(proposed_changes) = 'object'
    AND octet_length(proposed_changes::text) BETWEEN 2 AND 20000
  ),
  CONSTRAINT ai_approval_requests_consequences_length CHECK (
    char_length(consequences) BETWEEN 3 AND 4000
  ),
  CONSTRAINT ai_approval_requests_expiry CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '48 hours'
  ),
  CONSTRAINT ai_approval_requests_decision_shape CHECK (
    (
      status = 'pending'
      AND decided_at IS NULL
      AND decided_by_user_id IS NULL
      AND decision_reason IS NULL
    ) OR (
      status <> 'pending'
      AND decided_at IS NOT NULL
      AND (
        status = 'expired'
        OR decided_by_user_id IS NOT NULL
      )
    )
  ),
  CONSTRAINT ai_approval_requests_reason_length CHECK (
    decision_reason IS NULL OR char_length(decision_reason) BETWEEN 3 AND 1000
  )
);

CREATE INDEX ai_approval_requests_tenant_status_idx
  ON public.ai_approval_requests (tenant_id, status, expires_at);

CREATE FUNCTION public.reject_ai_trace_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'AI trace steps are immutable' USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER ai_run_steps_immutable
BEFORE UPDATE OR DELETE ON public.ai_run_steps
FOR EACH ROW EXECUTE FUNCTION public.reject_ai_trace_mutation();

ALTER TABLE public.ai_agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_approval_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_agent_runs_read_office ON public.ai_agent_runs
FOR SELECT TO authenticated
USING (
  public.current_user_has_tenant_role(
    tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  )
);

CREATE POLICY ai_run_steps_read_office ON public.ai_run_steps
FOR SELECT TO authenticated
USING (
  public.current_user_has_tenant_role(
    tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  )
);

CREATE POLICY ai_approval_requests_read_office ON public.ai_approval_requests
FOR SELECT TO authenticated
USING (
  public.current_user_has_tenant_role(
    tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  )
);

REVOKE ALL ON public.ai_agent_runs FROM anon, authenticated;
REVOKE ALL ON public.ai_run_steps FROM anon, authenticated;
REVOKE ALL ON public.ai_approval_requests FROM anon, authenticated;
GRANT SELECT ON public.ai_agent_runs TO authenticated;
GRANT SELECT ON public.ai_run_steps TO authenticated;
GRANT SELECT ON public.ai_approval_requests TO authenticated;

CREATE FUNCTION public.begin_stub_ai_run(
  target_tenant_id uuid,
  target_actor_user_id uuid,
  target_agent_kind public.ai_agent_kind,
  target_policy_version text,
  target_correlation_id uuid,
  target_redacted_input_summary text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  run_id uuid;
  ai_enabled boolean;
  tenant_budget integer;
  plan_budget bigint;
  effective_budget bigint;
  spent_this_month bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.memberships membership
    WHERE membership.tenant_id = target_tenant_id
      AND membership.user_id = target_actor_user_id
      AND membership.status = 'active'
      AND membership.role IN ('owner', 'office')
  ) THEN
    RAISE EXCEPTION 'active office actor required' USING ERRCODE = '42501';
  END IF;

  SELECT settings.ai_operations_enabled, settings.ai_monthly_budget_cents
  INTO ai_enabled, tenant_budget
  FROM public.tenant_settings settings
  WHERE settings.tenant_id = target_tenant_id;

  IF NOT coalesce(ai_enabled, false) THEN
    RAISE EXCEPTION 'AI operations are disabled' USING ERRCODE = '42501';
  END IF;

  SELECT plan.ai_monthly_budget_cents
  INTO plan_budget
  FROM public.tenant_subscriptions subscription
  JOIN public.billing_plans plan ON plan.code = subscription.plan_code
  WHERE subscription.tenant_id = target_tenant_id;

  effective_budget := CASE
    WHEN plan_budget IS NULL THEN tenant_budget
    ELSE least(tenant_budget::bigint, plan_budget)
  END;

  SELECT coalesce(sum(run.estimated_cost_cents), 0)
  INTO spent_this_month
  FROM public.ai_agent_runs run
  WHERE run.tenant_id = target_tenant_id
    AND run.created_at >= date_trunc('month', now());

  IF effective_budget <= spent_this_month THEN
    RAISE EXCEPTION 'AI monthly budget exhausted' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.ai_agent_runs (
    tenant_id, actor_user_id, agent_kind, policy_version, correlation_id,
    redacted_input_summary
  ) VALUES (
    target_tenant_id, target_actor_user_id, target_agent_kind,
    trim(target_policy_version), target_correlation_id,
    trim(target_redacted_input_summary)
  )
  ON CONFLICT (tenant_id, correlation_id) DO UPDATE
  SET correlation_id = EXCLUDED.correlation_id
  WHERE ai_agent_runs.actor_user_id IS NOT DISTINCT FROM EXCLUDED.actor_user_id
    AND ai_agent_runs.agent_kind = EXCLUDED.agent_kind
    AND ai_agent_runs.policy_version = EXCLUDED.policy_version
    AND ai_agent_runs.redacted_input_summary = EXCLUDED.redacted_input_summary
  RETURNING id INTO run_id;

  IF run_id IS NULL THEN
    RAISE EXCEPTION 'AI correlation payload conflict' USING ERRCODE = '23505';
  END IF;

  RETURN run_id;
END;
$$;

CREATE FUNCTION public.decide_ai_approval(
  target_approval_id uuid,
  target_decision public.ai_approval_status,
  target_reason text
)
RETURNS public.ai_approval_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  approval public.ai_approval_requests%ROWTYPE;
  current_user_id uuid := auth.uid();
  final_status public.ai_approval_status;
BEGIN
  IF target_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'approval decision must be approved or rejected'
      USING ERRCODE = '22023';
  END IF;

  SELECT request.* INTO approval
  FROM public.ai_approval_requests request
  WHERE request.id = target_approval_id
  FOR UPDATE;

  IF approval.id IS NULL OR NOT public.current_user_has_tenant_role(
    approval.tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'approval not found or unavailable' USING ERRCODE = '42501';
  END IF;

  IF approval.status <> 'pending' THEN
    RAISE EXCEPTION 'approval is no longer pending' USING ERRCODE = 'P0001';
  END IF;

  final_status := CASE
    WHEN approval.expires_at <= now() THEN 'expired'::public.ai_approval_status
    ELSE target_decision
  END;

  UPDATE public.ai_approval_requests
  SET status = final_status,
      decided_by_user_id = CASE WHEN final_status = 'expired' THEN NULL ELSE current_user_id END,
      decided_at = now(),
      decision_reason = CASE
        WHEN final_status = 'expired' THEN 'Approval expired before decision.'
        ELSE nullif(trim(target_reason), '')
      END
  WHERE id = approval.id;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    approval.tenant_id,
    current_user_id,
    'ai.approval_' || final_status::text,
    'ai_approval_request',
    approval.id,
    jsonb_build_object(
      'run_id', approval.run_id,
      'action_kind', approval.action_kind
    )
  );

  RETURN final_status;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_ai_trace_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_stub_ai_run(
  uuid, uuid, public.ai_agent_kind, text, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_stub_ai_run(
  uuid, uuid, public.ai_agent_kind, text, uuid, text
) TO service_role;
REVOKE ALL ON FUNCTION public.decide_ai_approval(
  uuid, public.ai_approval_status, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_ai_approval(
  uuid, public.ai_approval_status, text
) TO authenticated;

COMMENT ON TABLE public.ai_agent_runs IS
  'Tenant-scoped, redacted AI run ledger. Phase 6 initially permits only deterministic stub runs.';
COMMENT ON TABLE public.ai_run_steps IS
  'Immutable redacted steps for inspecting an AI run without retaining raw prompts or tool payloads.';
COMMENT ON TABLE public.ai_approval_requests IS
  'Human approval requests with exact proposed changes, consequences, and a maximum 48-hour lifetime.';
