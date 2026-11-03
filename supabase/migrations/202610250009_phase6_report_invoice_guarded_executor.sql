-- CrewFlow Phase 6: guarded execution for approved Report invoice drafts.
-- Execution re-derives trusted pricing and creates one editable draft only.

CREATE FUNCTION public.execute_approved_report_invoice_draft(
  target_approval_id uuid
)
RETURNS TABLE (
  execution_result text,
  job_id uuid,
  invoice_id uuid,
  result_message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  approval public.ai_approval_requests%ROWTYPE;
  locked_job public.jobs%ROWTYPE;
  accepted_quote public.quotes%ROWTYPE;
  catalog_service public.services%ROWTYPE;
  saved_invoice_id uuid;
  existing_invoice_id uuid;
  invoice_items jsonb;
  invoice_discount_cents bigint := 0;
  invoice_subtotal_cents bigint := 0;
  taxable_subtotal_cents bigint := 0;
  taxable_discount_cents bigint := 0;
  invoice_tax_cents bigint := 0;
  invoice_total_cents bigint := 0;
  tenant_tax_rate_bps integer;
  proposed_due_at timestamptz;
  source_kind text;
  source_id uuid;
  source_updated_at timestamptz;
  current_state_version text;
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

  IF approval.action_kind <> 'report.save_invoice_draft'
    OR approval.target_entity_type <> 'job'
    OR approval.target_entity_id IS NULL THEN
    RAISE EXCEPTION 'approval is not a Report invoice draft save'
      USING ERRCODE = '22023';
  END IF;

  IF approval.status <> 'approved' THEN
    RAISE EXCEPTION 'Report invoice draft save requires an approved request'
      USING ERRCODE = 'P0001';
  END IF;

  IF approval.execution_status IS NOT NULL THEN
    IF approval.execution_status = 'succeeded' THEN
      SELECT invoice.id
      INTO saved_invoice_id
      FROM public.invoices AS invoice
      WHERE invoice.tenant_id = approval.tenant_id
        AND invoice.job_id = approval.target_entity_id
        AND invoice.status = 'draft'
      ORDER BY invoice.created_at DESC
      LIMIT 1;
    END IF;

    RETURN QUERY SELECT
      approval.execution_status,
      approval.target_entity_id,
      saved_invoice_id,
      approval.execution_message;
    RETURN;
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

  IF NOT coalesce(has_full_access, false) THEN
    rejection_message :=
      'Subscription access is no longer full. The invoice draft was not saved.';

    UPDATE public.ai_approval_requests
    SET execution_status = 'rejected_policy', executed_at = now(),
        executed_by_user_id = auth.uid(), execution_message = rejection_message
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
      'guarded_execution', 'report.save_invoice_draft', rejection_message,
      'rejected_policy', 0
    );

    INSERT INTO public.audit_events (
      tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
      approval.tenant_id, auth.uid(), 'ai.report_invoice_execution_rejected',
      'job', approval.target_entity_id,
      jsonb_build_object(
        'approval_id', approval.id, 'run_id', approval.run_id,
        'reason', 'subscription_access'
      )
    );

    RETURN QUERY SELECT
      'rejected_policy'::text, approval.target_entity_id, NULL::uuid,
      rejection_message;
    RETURN;
  END IF;

  SELECT invoice.id
  INTO existing_invoice_id
  FROM public.invoices AS invoice
  WHERE invoice.tenant_id = approval.tenant_id
    AND invoice.job_id = approval.target_entity_id
    AND invoice.status <> 'void'
  ORDER BY invoice.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF locked_job.id IS NOT NULL
    AND locked_job.archived_at IS NULL
    AND locked_job.status IN ('completed', 'closed')
    AND existing_invoice_id IS NULL THEN
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
  END IF;

  IF source_id IS NOT NULL AND invoice_items IS NOT NULL THEN
    taxable_discount_cents := CASE
      WHEN invoice_subtotal_cents = 0 THEN 0
      ELSE round(
        invoice_discount_cents::numeric * taxable_subtotal_cents::numeric
          / invoice_subtotal_cents::numeric
      )::bigint
    END;
    invoice_tax_cents := round(
      greatest(
        taxable_subtotal_cents - taxable_discount_cents, 0::bigint
      )::numeric * tenant_tax_rate_bps::numeric / 10000
    )::bigint;
    invoice_total_cents :=
      invoice_subtotal_cents - invoice_discount_cents + invoice_tax_cents;

    current_state_version := pg_catalog.encode(
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
  END IF;

  BEGIN
    proposed_due_at :=
      (approval.proposed_changes #>> '{dueAt,to}')::timestamptz;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN
    proposed_due_at := NULL;
  END;

  IF locked_job.id IS NULL
    OR locked_job.archived_at IS NOT NULL
    OR locked_job.status NOT IN ('completed', 'closed')
    OR existing_invoice_id IS NOT NULL
    OR source_id IS NULL
    OR invoice_items IS NULL
    OR current_state_version IS DISTINCT FROM approval.target_state_version
    OR approval.proposed_changes #> '{lineItems,to}' IS DISTINCT FROM invoice_items
    OR approval.proposed_changes #>> '{discountCents,to}'
      IS DISTINCT FROM invoice_discount_cents::text
    OR approval.proposed_changes #>> '{taxRateBps,to}'
      IS DISTINCT FROM tenant_tax_rate_bps::text
    OR approval.proposed_changes #>> '{subtotalCents,to}'
      IS DISTINCT FROM invoice_subtotal_cents::text
    OR approval.proposed_changes #>> '{taxCents,to}'
      IS DISTINCT FROM invoice_tax_cents::text
    OR approval.proposed_changes #>> '{totalCents,to}'
      IS DISTINCT FROM invoice_total_cents::text
    OR approval.proposed_changes #> '{paymentUrl,to}'
      IS DISTINCT FROM 'null'::jsonb
    OR proposed_due_at IS NULL
    OR proposed_due_at <= now()
    OR proposed_due_at > now() + interval '365 days' THEN
    rejection_message :=
      'Job, pricing, tax, due date, or duplicate-invoice state changed. Create a fresh invoice proposal.';

    UPDATE public.ai_approval_requests
    SET execution_status = 'rejected_stale', executed_at = now(),
        executed_by_user_id = auth.uid(), execution_message = rejection_message
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
      'guarded_execution', 'report.save_invoice_draft', rejection_message,
      'rejected_stale', 0
    );

    INSERT INTO public.audit_events (
      tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
      approval.tenant_id, auth.uid(), 'ai.report_invoice_execution_rejected',
      'job', approval.target_entity_id,
      jsonb_build_object(
        'approval_id', approval.id, 'run_id', approval.run_id,
        'reason', 'stale_pricing_or_duplicate'
      )
    );

    RETURN QUERY SELECT
      'rejected_stale'::text, approval.target_entity_id, NULL::uuid,
      rejection_message;
    RETURN;
  END IF;

  saved_invoice_id := public.save_job_invoice(
    locked_job.id, invoice_items, invoice_discount_cents,
    proposed_due_at, ''
  );

  UPDATE public.ai_approval_requests
  SET execution_status = 'succeeded', executed_at = now(),
      executed_by_user_id = auth.uid(),
      execution_message =
        'Approved invoice draft was saved after current pricing and duplicate-state revalidation.'
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
    'guarded_execution', 'report.save_invoice_draft',
    'Approved editable invoice draft saved after role, subscription, pricing, tax, due-date, exact-diff, and duplicate-state checks. It was not sent or paid.',
    'succeeded', 0
  );

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    approval.tenant_id, auth.uid(), 'ai.report_invoice_executed',
    'invoice', saved_invoice_id,
    jsonb_build_object(
      'approval_id', approval.id, 'run_id', approval.run_id,
      'job_id', locked_job.id
    )
  );

  RETURN QUERY SELECT
    'succeeded'::text, locked_job.id, saved_invoice_id,
    'Approved invoice draft saved. Review and send it separately.'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_approved_report_invoice_draft(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_approved_report_invoice_draft(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.execute_approved_report_invoice_draft(uuid) IS
  'Idempotently saves one approved editable invoice draft after current role, subscription, trusted-pricing, tax, due-date, exact-diff, and duplicate-state revalidation.';
