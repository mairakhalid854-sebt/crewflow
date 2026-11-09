-- AI Autopilot: owner-controlled automatic approval for low-risk AI actions.
--
-- Every policy is OFF by default. When an owner turns a policy on, a
-- scheduled worker approves matching pending AI approvals on that owner's
-- behalf and runs the existing guarded executor. The executors keep every
-- safety check they already have (role, subscription, current state,
-- eligibility, consent, idempotency), so Autopilot can never do more than the
-- owner could do by pressing Approve. In-progress reassignments are never
-- eligible.

CREATE TABLE public.ai_autopilot_policies (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  policy_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  updated_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, policy_key),
  CONSTRAINT ai_autopilot_policies_key CHECK (
    policy_key IN (
      'follow_up.payment_reminder',
      'follow_up.review_request',
      'dispatcher.assign_new',
      'report.save_draft',
      'report.save_invoice_draft',
      'intake.create_draft_records'
    )
  ),
  CONSTRAINT ai_autopilot_policies_enabled_actor CHECK (
    NOT enabled OR updated_by_user_id IS NOT NULL
  )
);

CREATE TABLE public.ai_autopilot_executions (
  approval_id uuid PRIMARY KEY
    REFERENCES public.ai_approval_requests(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  policy_key text NOT NULL,
  acting_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  outcome text NOT NULL,
  execution_result text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_autopilot_executions_outcome CHECK (
    outcome IN (
      'executed',
      'execution_rejected',
      'skipped_inactive_owner',
      'expired',
      'failed'
    )
  ),
  CONSTRAINT ai_autopilot_executions_result_length CHECK (
    execution_result IS NULL OR char_length(execution_result) <= 120
  ),
  CONSTRAINT ai_autopilot_executions_error_length CHECK (
    error_message IS NULL OR char_length(error_message) <= 500
  )
);

CREATE INDEX ai_autopilot_executions_tenant_created_idx
  ON public.ai_autopilot_executions (tenant_id, created_at DESC);

ALTER TABLE public.ai_autopilot_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_autopilot_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_autopilot_policies_select ON public.ai_autopilot_policies
  FOR SELECT TO authenticated
  USING (
    public.current_user_has_tenant_role(
      tenant_id, ARRAY['owner', 'office']::public.membership_role[]
    )
  );

CREATE POLICY ai_autopilot_executions_select ON public.ai_autopilot_executions
  FOR SELECT TO authenticated
  USING (
    public.current_user_has_tenant_role(
      tenant_id, ARRAY['owner', 'office']::public.membership_role[]
    )
  );

REVOKE ALL ON public.ai_autopilot_policies FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ai_autopilot_executions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ai_autopilot_policies TO authenticated;
GRANT SELECT ON public.ai_autopilot_executions TO authenticated;

-- Maps a pending approval to the Autopilot policy that may approve it.
-- Returns NULL for anything Autopilot must never touch.
CREATE FUNCTION public.ai_autopilot_policy_key(
  target_action_kind text,
  target_changes jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE target_action_kind
    WHEN 'follow_up.queue_message' THEN
      CASE WHEN target_changes #>> '{message,to,kind}' = 'review_request'
        THEN 'follow_up.review_request'
        ELSE 'follow_up.payment_reminder'
      END
    WHEN 'dispatcher.assign_technician' THEN
      -- Only first-time assignments; any reassignment stays human-approved.
      CASE WHEN target_changes #>> '{assignedMembershipId,from}' IS NULL
        THEN 'dispatcher.assign_new'
        ELSE NULL
      END
    WHEN 'report.save_draft' THEN 'report.save_draft'
    WHEN 'report.save_invoice_draft' THEN 'report.save_invoice_draft'
    WHEN 'intake.create_draft_records' THEN 'intake.create_draft_records'
    ELSE NULL
  END;
$$;

CREATE FUNCTION public.set_ai_autopilot_policy(
  target_tenant_id uuid,
  target_policy_key text,
  target_enabled boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id uuid := auth.uid();
BEGIN
  IF NOT public.current_user_has_tenant_role(
    target_tenant_id, ARRAY['owner']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'only an active owner can change Autopilot'
      USING ERRCODE = '42501';
  END IF;

  IF target_enabled IS NULL THEN
    RAISE EXCEPTION 'Autopilot setting is required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.ai_autopilot_policies (
    tenant_id, policy_key, enabled, updated_by_user_id, updated_at
  ) VALUES (
    target_tenant_id, target_policy_key, target_enabled, current_user_id, now()
  )
  ON CONFLICT (tenant_id, policy_key) DO UPDATE
  SET enabled = EXCLUDED.enabled,
      updated_by_user_id = EXCLUDED.updated_by_user_id,
      updated_at = EXCLUDED.updated_at;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    target_tenant_id,
    current_user_id,
    CASE WHEN target_enabled
      THEN 'ai.autopilot_enabled'
      ELSE 'ai.autopilot_disabled'
    END,
    'ai_autopilot_policy',
    NULL,
    jsonb_build_object('policy_key', target_policy_key)
  );

  RETURN target_enabled;
END;
$$;

REVOKE ALL ON FUNCTION public.set_ai_autopilot_policy(uuid, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_ai_autopilot_policy(uuid, text, boolean)
  TO authenticated;

CREATE FUNCTION public.run_ai_autopilot(max_items integer DEFAULT 50)
RETURNS TABLE (
  executed_count integer,
  rejected_count integer,
  skipped_count integer,
  failed_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  candidate record;
  decision public.ai_approval_status;
  result_text text;
  executed_total integer := 0;
  rejected_total integer := 0;
  skipped_total integer := 0;
  failed_total integer := 0;
BEGIN
  IF session_user <> 'postgres'
    AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  FOR candidate IN
    SELECT
      approval.id,
      approval.tenant_id,
      approval.action_kind,
      policy.policy_key,
      policy.updated_by_user_id AS actor_id
    FROM public.ai_approval_requests AS approval
    JOIN public.ai_autopilot_policies AS policy
      ON policy.tenant_id = approval.tenant_id
     AND policy.enabled
     AND policy.policy_key = public.ai_autopilot_policy_key(
       approval.action_kind, approval.proposed_changes
     )
    JOIN public.tenant_settings AS settings
      ON settings.tenant_id = approval.tenant_id
     AND settings.ai_operations_enabled
    WHERE approval.status = 'pending'
      AND approval.expires_at > now()
      AND NOT EXISTS (
        SELECT 1
        FROM public.ai_autopilot_executions AS done
        WHERE done.approval_id = approval.id
      )
    ORDER BY approval.created_at
    LIMIT greatest(1, least(coalesce(max_items, 50), 200))
    FOR UPDATE OF approval SKIP LOCKED
  LOOP
    -- The owner who enabled the policy must still be an active owner.
    IF NOT EXISTS (
      SELECT 1
      FROM public.memberships AS membership
      WHERE membership.tenant_id = candidate.tenant_id
        AND membership.user_id = candidate.actor_id
        AND membership.status = 'active'
        AND membership.role = 'owner'
    ) THEN
      INSERT INTO public.ai_autopilot_executions (
        approval_id, tenant_id, policy_key, acting_user_id, outcome
      ) VALUES (
        candidate.id, candidate.tenant_id, candidate.policy_key,
        candidate.actor_id, 'skipped_inactive_owner'
      );
      skipped_total := skipped_total + 1;
      CONTINUE;
    END IF;

    BEGIN
      -- Act as the owner for this approval only; executors re-check roles.
      PERFORM set_config(
        'request.jwt.claims',
        jsonb_build_object(
          'sub', candidate.actor_id,
          'role', 'authenticated'
        )::text,
        true
      );

      decision := public.decide_ai_approval(
        candidate.id,
        'approved',
        'Approved automatically by Autopilot (' || candidate.policy_key || ').'
      );

      IF decision <> 'approved' THEN
        PERFORM set_config('request.jwt.claims', '', true);
        INSERT INTO public.ai_autopilot_executions (
          approval_id, tenant_id, policy_key, acting_user_id, outcome
        ) VALUES (
          candidate.id, candidate.tenant_id, candidate.policy_key,
          candidate.actor_id, 'expired'
        );
        skipped_total := skipped_total + 1;
        CONTINUE;
      END IF;

      CASE candidate.action_kind
        WHEN 'follow_up.queue_message' THEN
          SELECT execution.execution_result INTO result_text
          FROM public.execute_approved_follow_up_message(candidate.id) AS execution;
        WHEN 'dispatcher.assign_technician' THEN
          SELECT execution.execution_result INTO result_text
          FROM public.execute_approved_dispatcher_assignment(candidate.id) AS execution;
        WHEN 'report.save_draft' THEN
          SELECT execution.execution_result INTO result_text
          FROM public.execute_approved_report_draft(candidate.id) AS execution;
        WHEN 'report.save_invoice_draft' THEN
          SELECT execution.execution_result INTO result_text
          FROM public.execute_approved_report_invoice_draft(candidate.id) AS execution;
        WHEN 'intake.create_draft_records' THEN
          SELECT execution.execution_result INTO result_text
          FROM public.execute_approved_intake_draft_records(candidate.id) AS execution;
      END CASE;

      PERFORM set_config('request.jwt.claims', '', true);

      INSERT INTO public.ai_autopilot_executions (
        approval_id, tenant_id, policy_key, acting_user_id, outcome,
        execution_result
      ) VALUES (
        candidate.id, candidate.tenant_id, candidate.policy_key,
        candidate.actor_id,
        CASE WHEN result_text = 'succeeded'
          THEN 'executed'
          ELSE 'execution_rejected'
        END,
        left(result_text, 120)
      );

      INSERT INTO public.audit_events (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
      ) VALUES (
        candidate.tenant_id,
        candidate.actor_id,
        'ai.autopilot_executed',
        'ai_approval_request',
        candidate.id,
        jsonb_build_object(
          'policy_key', candidate.policy_key,
          'action_kind', candidate.action_kind,
          'execution_result', result_text
        )
      );

      IF result_text = 'succeeded' THEN
        executed_total := executed_total + 1;
      ELSE
        rejected_total := rejected_total + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- The approval and any partial work roll back; a person can still
      -- decide it manually. The record stops endless retries.
      PERFORM set_config('request.jwt.claims', '', true);
      INSERT INTO public.ai_autopilot_executions (
        approval_id, tenant_id, policy_key, acting_user_id, outcome,
        error_message
      ) VALUES (
        candidate.id, candidate.tenant_id, candidate.policy_key,
        candidate.actor_id, 'failed', left(SQLERRM, 500)
      );
      failed_total := failed_total + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT executed_total, rejected_total, skipped_total, failed_total;
END;
$$;

REVOKE ALL ON FUNCTION public.run_ai_autopilot(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_ai_autopilot(integer) TO service_role;

REVOKE ALL ON FUNCTION public.ai_autopilot_policy_key(text, jsonb)
  FROM PUBLIC, anon, authenticated;

DO $$
DECLARE existing_job_id bigint;
BEGIN
  SELECT jobid INTO existing_job_id
  FROM cron.job WHERE jobname = 'crewflow-ai-autopilot' LIMIT 1;
  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;
  PERFORM cron.schedule(
    'crewflow-ai-autopilot',
    '*/2 * * * *',
    'SELECT * FROM public.run_ai_autopilot(50);'
  );
END;
$$;

COMMENT ON TABLE public.ai_autopilot_policies IS
  'Owner-controlled per-tenant Autopilot switches. Every policy is off until an owner enables it.';
COMMENT ON TABLE public.ai_autopilot_executions IS
  'One immutable record per approval Autopilot handled, including rejections and failures.';
COMMENT ON FUNCTION public.run_ai_autopilot(integer) IS
  'Service-only worker: approves matching pending AI approvals as the enabling owner, then runs the existing guarded executor.';
