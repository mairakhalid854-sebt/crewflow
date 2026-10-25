-- CrewFlow Phase 6: authoritative deterministic Report invoice orchestration.
-- The RPC proposes an editable invoice draft but never writes an invoice,
-- publishes a customer link, records payment, or sends a communication.

CREATE FUNCTION public.request_report_invoice_proposal(
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
  new_run_id uuid;
  new_approval_id uuid;
  accepted_quote public.quotes%ROWTYPE;
  catalog_service public.services%ROWTYPE;
  invoice_items jsonb;
  invoice_discount_cents bigint := 0;
  invoice_subtotal_cents bigint := 0;
  taxable_subtotal_cents bigint := 0;
  taxable_discount_cents bigint := 0;
  invoice_tax_cents bigint := 0;
  invoice_total_cents bigint := 0;
  tenant_tax_rate_bps integer;
  invoice_due_at timestamptz := now() + interval '14 days';
  source_kind text;
  source_id uuid;
  source_updated_at timestamptz;
  pricing_state_version text;
  proposed_changes jsonb;
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
    RAISE EXCEPTION 'job must be completed or closed for invoice drafting'
      USING ERRCODE = '22023';
  END IF;

  run_summary := concat('Report invoice evaluation for job ', locked_job.id);

  SELECT run.*
  INTO existing_run
  FROM public.ai_agent_runs AS run
  WHERE run.tenant_id = locked_job.tenant_id
    AND run.correlation_id = target_correlation_id;

  IF FOUND THEN
    IF existing_run.actor_user_id IS DISTINCT FROM auth.uid()
      OR existing_run.agent_kind <> 'report'
      OR existing_run.policy_version <> 'report-invoice-v1'
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
      'Existing Report invoice evaluation returned.'::text;
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

  IF EXISTS (
    SELECT 1
    FROM public.invoices AS invoice
    WHERE invoice.job_id = locked_job.id
      AND invoice.tenant_id = locked_job.tenant_id
      AND invoice.status <> 'void'
  ) THEN
    INSERT INTO public.ai_agent_runs (
      tenant_id, actor_user_id, agent_kind, policy_version, correlation_id,
      status, redacted_input_summary, completed_at
    ) VALUES (
      locked_job.tenant_id, auth.uid(), 'report', 'report-invoice-v1',
      target_correlation_id, 'succeeded', run_summary, now()
    ) RETURNING id INTO new_run_id;

    INSERT INTO public.ai_run_steps (
      tenant_id, run_id, sequence_number, step_kind, redacted_summary,
      outcome, duration_ms
    ) VALUES (
      locked_job.tenant_id, new_run_id, 1, 'duplicate_prevention',
      'An active invoice already exists; no duplicate draft was proposed.',
      'unchanged', 0
    );

    INSERT INTO public.audit_events (
      tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
      locked_job.tenant_id, auth.uid(), 'ai.report_invoice_unchanged',
      'job', locked_job.id, jsonb_build_object('run_id', new_run_id)
    );

    RETURN QUERY SELECT
      new_run_id, NULL::uuid, 'unchanged'::text,
      'The job already has an active invoice. No duplicate was proposed.'::text;
    RETURN;
  END IF;

  SELECT tenant.tax_rate_bps
  INTO tenant_tax_rate_bps
  FROM public.tenants AS tenant
  WHERE tenant.id = locked_job.tenant_id;

  SELECT quote.*
  INTO accepted_quote
  FROM public.quotes AS quote
  WHERE quote.job_id = locked_job.id
    AND quote.tenant_id = locked_job.tenant_id
    AND quote.status = 'accepted'
  ORDER BY quote.accepted_at DESC, quote.id
  LIMIT 1;

  IF accepted_quote.id IS NOT NULL THEN
    SELECT
      jsonb_agg(
        jsonb_build_object(
          'description', line.description,
          'quantity', line.quantity,
          'taxable', line.taxable,
          'unit_price_cents', line.unit_price_cents
        ) ORDER BY line.position
      ),
      coalesce(sum(line.line_total_cents), 0),
      coalesce(sum(line.line_total_cents) FILTER (WHERE line.taxable), 0)
    INTO invoice_items, invoice_subtotal_cents, taxable_subtotal_cents
    FROM public.quote_line_items AS line
    WHERE line.quote_id = accepted_quote.id
      AND line.tenant_id = locked_job.tenant_id;

    invoice_discount_cents := accepted_quote.discount_cents;
    source_kind := 'accepted_quote';
    source_id := accepted_quote.id;
    source_updated_at := accepted_quote.updated_at;
  ELSE
    SELECT service.*
    INTO catalog_service
    FROM public.services AS service
    WHERE service.id = locked_job.service_id
      AND service.tenant_id = locked_job.tenant_id
      AND service.archived_at IS NULL
      AND service.is_enabled;

    IF catalog_service.id IS NOT NULL THEN
      invoice_items := jsonb_build_array(jsonb_build_object(
        'description', catalog_service.name,
        'quantity', 1,
        'taxable', catalog_service.tax_behavior <> 'non_taxable',
        'unit_price_cents', catalog_service.unit_price_cents
      ));
      invoice_subtotal_cents := catalog_service.unit_price_cents;
      taxable_subtotal_cents := CASE
        WHEN catalog_service.tax_behavior = 'non_taxable' THEN 0
        ELSE catalog_service.unit_price_cents
      END;
      source_kind := 'catalog_service';
      source_id := catalog_service.id;
      source_updated_at := catalog_service.updated_at;
    END IF;
  END IF;

  IF source_id IS NULL
    OR invoice_items IS NULL
    OR jsonb_array_length(invoice_items) NOT BETWEEN 1 AND 50
    OR invoice_discount_cents < 0
    OR invoice_discount_cents > invoice_subtotal_cents THEN
    INSERT INTO public.ai_agent_runs (
      tenant_id, actor_user_id, agent_kind, policy_version, correlation_id,
      status, redacted_input_summary, completed_at
    ) VALUES (
      locked_job.tenant_id, auth.uid(), 'report', 'report-invoice-v1',
      target_correlation_id, 'escalated', run_summary, now()
    ) RETURNING id INTO new_run_id;

    INSERT INTO public.ai_run_steps (
      tenant_id, run_id, sequence_number, step_kind, redacted_summary,
      outcome, duration_ms
    ) VALUES (
      locked_job.tenant_id, new_run_id, 1, 'pricing_validation',
      'No valid accepted-quote or enabled catalog-service pricing was available.',
      'escalated', 0
    );

    INSERT INTO public.audit_events (
      tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
      locked_job.tenant_id, auth.uid(), 'ai.report_invoice_escalated',
      'job', locked_job.id,
      jsonb_build_object('run_id', new_run_id, 'reason', 'trusted_pricing')
    );

    RETURN QUERY SELECT
      new_run_id, NULL::uuid, 'escalated'::text,
      'No trusted accepted quote or enabled catalog service price is available.'::text;
    RETURN;
  END IF;

  taxable_discount_cents := CASE
    WHEN invoice_subtotal_cents = 0 THEN 0
    ELSE round(
      invoice_discount_cents::numeric * taxable_subtotal_cents::numeric
        / invoice_subtotal_cents::numeric
    )::bigint
  END;
  invoice_tax_cents := round(
    greatest(
      taxable_subtotal_cents - taxable_discount_cents,
      0::bigint
    )::numeric * tenant_tax_rate_bps::numeric / 10000
  )::bigint;
  invoice_total_cents :=
    invoice_subtotal_cents - invoice_discount_cents + invoice_tax_cents;

  proposed_changes := jsonb_build_object(
    'lineItems', jsonb_build_object('from', NULL, 'to', invoice_items),
    'discountCents', jsonb_build_object(
      'from', NULL, 'to', invoice_discount_cents
    ),
    'taxRateBps', jsonb_build_object(
      'from', NULL, 'to', tenant_tax_rate_bps
    ),
    'subtotalCents', jsonb_build_object(
      'from', NULL, 'to', invoice_subtotal_cents
    ),
    'taxCents', jsonb_build_object('from', NULL, 'to', invoice_tax_cents),
    'totalCents', jsonb_build_object(
      'from', NULL, 'to', invoice_total_cents
    ),
    'dueAt', jsonb_build_object('from', NULL, 'to', invoice_due_at),
    'paymentUrl', jsonb_build_object('from', NULL, 'to', NULL)
  );

  IF octet_length(proposed_changes::text) > 20000 THEN
    RAISE EXCEPTION 'invoice proposal exceeds the governed approval limit'
      USING ERRCODE = '22023';
  END IF;

  pricing_state_version := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        concat_ws(
          '|', locked_job.updated_at::text, source_kind, source_id::text,
          source_updated_at::text, invoice_items::text,
          invoice_discount_cents::text, tenant_tax_rate_bps::text
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
    locked_job.tenant_id, auth.uid(), 'report', 'report-invoice-v1',
    target_correlation_id, 'succeeded', run_summary, now()
  ) RETURNING id INTO new_run_id;

  INSERT INTO public.ai_run_steps (
    tenant_id, run_id, sequence_number, step_kind, redacted_summary,
    outcome, duration_ms
  ) VALUES (
    locked_job.tenant_id, new_run_id, 1, 'pricing_validation',
    format(
      'Grounded %s invoice line items in %s %s. Field notes, photos, parts, and recommendations were not converted into charges.',
      jsonb_array_length(invoice_items), source_kind, source_id
    ),
    'grounded', 0
  );

  SELECT approval.id
  INTO existing_approval_id
  FROM public.ai_approval_requests AS approval
  WHERE approval.tenant_id = locked_job.tenant_id
    AND approval.action_kind = 'report.save_invoice_draft'
    AND approval.target_entity_type = 'job'
    AND approval.target_entity_id = locked_job.id
    AND approval.target_state_version = pricing_state_version
    AND approval.status = 'pending'
    AND approval.expires_at > now()
  ORDER BY approval.created_at DESC
  LIMIT 1;

  IF existing_approval_id IS NOT NULL THEN
    RETURN QUERY SELECT
      new_run_id, existing_approval_id, 'proposed'::text,
      'A current invoice-draft approval already exists for this pricing state.'::text;
    RETURN;
  END IF;

  INSERT INTO public.ai_approval_requests (
    tenant_id, run_id, action_kind, rationale, proposed_changes,
    consequences, target_entity_type, target_entity_id,
    target_state_version, requested_by_user_id
  ) VALUES (
    locked_job.tenant_id,
    new_run_id,
    'report.save_invoice_draft',
    format(
      'Used %s %s for %s line items and a %s-cent discount. Applied the current tenant tax rate of %s basis points. No field evidence or payment link was converted into a charge.',
      source_kind, source_id, jsonb_array_length(invoice_items),
      invoice_discount_cents, tenant_tax_rate_bps
    ),
    proposed_changes,
    'Approval may create one editable invoice draft only. It cannot publish or email an invoice, create a payment link, record payment, or contact the customer. Execution must revalidate pricing and duplicate state.',
    'job', locked_job.id, pricing_state_version, auth.uid()
  ) RETURNING id INTO new_approval_id;

  INSERT INTO public.ai_run_steps (
    tenant_id, run_id, sequence_number, step_kind, tool_name,
    redacted_summary, outcome, duration_ms
  ) VALUES (
    locked_job.tenant_id, new_run_id, 2, 'approval_requested',
    'report.save_invoice_draft',
    'Created mandatory office approval for an editable invoice draft; no invoice was written or sent.',
    'pending_approval', 0
  );

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    locked_job.tenant_id, auth.uid(), 'ai.report_invoice_proposed',
    'job', locked_job.id,
    jsonb_build_object(
      'run_id', new_run_id, 'approval_id', new_approval_id,
      'source_kind', source_kind, 'source_id', source_id,
      'line_item_count', jsonb_array_length(invoice_items)
    )
  );

  RETURN QUERY SELECT
    new_run_id, new_approval_id, 'proposed'::text,
    'Invoice draft proposal created for office review.'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.request_report_invoice_proposal(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_report_invoice_proposal(uuid, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.request_report_invoice_proposal(uuid, uuid) IS
  'Creates a tenant-authorized quote/catalog-grounded invoice draft approval without writing, publishing, paying, or sending an invoice.';
