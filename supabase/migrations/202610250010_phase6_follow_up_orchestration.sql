-- CrewFlow Phase 6: governed Follow-Up scheduling and provider-neutral queue.
-- The daily scheduler may propose messages. Only an approved, revalidated
-- message becomes ready; this migration never sends email.

ALTER TABLE public.customers
  ADD COLUMN email_suppressed_at timestamptz,
  ADD COLUMN email_suppression_reason text,
  ADD CONSTRAINT customers_email_suppression_shape CHECK (
    (email_suppressed_at IS NULL AND email_suppression_reason IS NULL)
    OR (
      email_suppressed_at IS NOT NULL
      AND char_length(email_suppression_reason) BETWEEN 3 AND 500
    )
  );

CREATE TYPE public.follow_up_message_kind AS ENUM (
  'overdue_3_day',
  'overdue_7_day',
  'overdue_14_day',
  'review_request'
);
CREATE TYPE public.follow_up_message_category AS ENUM (
  'transactional',
  'marketing'
);
CREATE TYPE public.follow_up_delivery_status AS ENUM (
  'awaiting_approval',
  'ready',
  'processing',
  'delivered',
  'failed',
  'cancelled'
);

CREATE TABLE public.follow_up_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  approval_id uuid REFERENCES public.ai_approval_requests(id) ON DELETE RESTRICT,
  kind public.follow_up_message_kind NOT NULL,
  category public.follow_up_message_category NOT NULL,
  milestone_day integer,
  dedupe_key text NOT NULL,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  payment_state_source public.payment_source NOT NULL,
  settled_at timestamptz,
  target_state_version text NOT NULL,
  status public.follow_up_delivery_status NOT NULL DEFAULT 'awaiting_approval',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_error_code text,
  provider_message_id text,
  ready_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT follow_up_messages_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT follow_up_messages_invoice_tenant_fk
    FOREIGN KEY (invoice_id, tenant_id)
    REFERENCES public.invoices(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT follow_up_messages_customer_tenant_fk
    FOREIGN KEY (customer_id, tenant_id)
    REFERENCES public.customers(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT follow_up_messages_dedupe_unique UNIQUE (tenant_id, dedupe_key),
  CONSTRAINT follow_up_messages_dedupe_length CHECK (
    char_length(dedupe_key) BETWEEN 10 AND 240
  ),
  CONSTRAINT follow_up_messages_email_length CHECK (
    char_length(to_email) BETWEEN 3 AND 320
  ),
  CONSTRAINT follow_up_messages_content_length CHECK (
    char_length(subject) BETWEEN 1 AND 240
    AND char_length(body) BETWEEN 1 AND 4000
  ),
  CONSTRAINT follow_up_messages_state_hash CHECK (
    target_state_version ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT follow_up_messages_milestone_shape CHECK (
    (
      kind = 'review_request'
      AND category = 'marketing'
      AND milestone_day IS NULL
      AND settled_at IS NOT NULL
    ) OR (
      kind <> 'review_request'
      AND category = 'transactional'
      AND milestone_day IN (3, 7, 14)
      AND settled_at IS NULL
    )
  ),
  CONSTRAINT follow_up_messages_attempt_bounds CHECK (
    attempt_count BETWEEN 0 AND 20
  ),
  CONSTRAINT follow_up_messages_error_length CHECK (
    last_error_code IS NULL OR char_length(last_error_code) BETWEEN 1 AND 120
  ),
  CONSTRAINT follow_up_messages_provider_id_length CHECK (
    provider_message_id IS NULL OR char_length(provider_message_id) <= 500
  ),
  CONSTRAINT follow_up_messages_delivery_shape CHECK (
    (status = 'awaiting_approval' AND approval_id IS NOT NULL AND ready_at IS NULL)
    OR (status IN ('ready', 'processing', 'failed') AND ready_at IS NOT NULL)
    OR (status = 'delivered' AND ready_at IS NOT NULL AND delivered_at IS NOT NULL)
    OR status = 'cancelled'
  )
);

CREATE INDEX follow_up_messages_tenant_status_idx
  ON public.follow_up_messages (tenant_id, status, next_attempt_at);
CREATE INDEX follow_up_messages_invoice_idx
  ON public.follow_up_messages (invoice_id, created_at DESC);

CREATE TRIGGER follow_up_messages_updated_at
BEFORE UPDATE ON public.follow_up_messages
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER follow_up_messages_tenant_immutable
BEFORE UPDATE ON public.follow_up_messages
FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_change();

ALTER TABLE public.follow_up_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY follow_up_messages_read_office ON public.follow_up_messages
FOR SELECT TO authenticated USING (
  public.current_user_has_tenant_role(
    tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  )
);
REVOKE ALL ON public.follow_up_messages FROM anon, authenticated;
GRANT SELECT ON public.follow_up_messages TO authenticated;

CREATE FUNCTION public.run_follow_up_scheduler(target_now timestamptz DEFAULT now())
RETURNS TABLE (proposed_count integer, skipped_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  candidate record;
  new_message_id uuid;
  new_run_id uuid;
  new_approval_id uuid;
  message_kind public.follow_up_message_kind;
  message_category public.follow_up_message_category;
  message_milestone integer;
  message_dedupe_key text;
  message_subject text;
  message_body text;
  message_state text;
  display_name text;
  outstanding_cents bigint;
  outstanding_display text;
  payment_source public.payment_source;
  settled_time timestamptz;
  tenant_budget integer;
  plan_budget bigint;
  effective_budget bigint;
  spent_this_month bigint;
  proposed_total integer := 0;
  skipped_total integer := 0;
BEGIN
  IF session_user <> 'postgres'
    AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF target_now IS NULL THEN
    RAISE EXCEPTION 'scheduler time is required' USING ERRCODE = '22023';
  END IF;

  FOR candidate IN
    SELECT
      invoice.id AS invoice_id,
      invoice.tenant_id,
      invoice.customer_id,
      invoice.invoice_number,
      invoice.status AS invoice_status,
      invoice.total_cents,
      invoice.paid_cents,
      invoice.due_at,
      invoice.updated_at AS invoice_updated_at,
      customer.first_name,
      customer.email,
      customer.transactional_email_allowed,
      customer.marketing_email_opted_in,
      customer.email_suppressed_at,
      customer.updated_at AS customer_updated_at,
      tenant.time_zone,
      settings.ai_monthly_budget_cents,
      payment.received_at AS settled_at,
      payment.source AS payment_source,
      CASE
        WHEN invoice.status IN ('sent', 'partially_paid') THEN
          (target_now AT TIME ZONE tenant.time_zone)::date
            - (invoice.due_at AT TIME ZONE tenant.time_zone)::date
        ELSE NULL
      END AS days_overdue,
      CASE
        WHEN invoice.status = 'paid' AND payment.received_at IS NOT NULL THEN
          (target_now AT TIME ZONE tenant.time_zone)::date
            - (payment.received_at AT TIME ZONE tenant.time_zone)::date
        ELSE NULL
      END AS days_since_paid
    FROM public.invoices AS invoice
    JOIN public.customers AS customer
      ON customer.id = invoice.customer_id
      AND customer.tenant_id = invoice.tenant_id
    JOIN public.tenants AS tenant ON tenant.id = invoice.tenant_id
    JOIN public.tenant_settings AS settings
      ON settings.tenant_id = invoice.tenant_id
      AND settings.ai_operations_enabled
      AND settings.ai_monthly_budget_cents > 0
    JOIN public.tenant_subscriptions AS subscription
      ON subscription.tenant_id = invoice.tenant_id
      AND subscription.access_mode = 'full'
    LEFT JOIN LATERAL (
      SELECT record.received_at, record.source
      FROM public.payment_records AS record
      WHERE record.invoice_id = invoice.id
        AND record.tenant_id = invoice.tenant_id
        AND record.record_type = 'payment'
        AND record.amount_cents > 0
      ORDER BY record.received_at DESC, record.id DESC
      LIMIT 1
    ) AS payment ON true
    WHERE customer.archived_at IS NULL
      AND customer.email IS NOT NULL
      AND customer.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      AND customer.email_suppressed_at IS NULL
      AND (
        (
          invoice.status IN ('sent', 'partially_paid')
          AND invoice.paid_cents < invoice.total_cents
          AND customer.transactional_email_allowed
          AND (
            (target_now AT TIME ZONE tenant.time_zone)::date
              - (invoice.due_at AT TIME ZONE tenant.time_zone)::date
          ) IN (3, 7, 14)
        ) OR (
          invoice.status = 'paid'
          AND invoice.paid_cents = invoice.total_cents
          AND payment.received_at IS NOT NULL
          AND customer.transactional_email_allowed
          AND customer.marketing_email_opted_in
          AND (
            (target_now AT TIME ZONE tenant.time_zone)::date
              - (payment.received_at AT TIME ZONE tenant.time_zone)::date
          ) = 2
        )
      )
    ORDER BY invoice.tenant_id, invoice.id
  LOOP
    SELECT plan.ai_monthly_budget_cents
    INTO plan_budget
    FROM public.tenant_subscriptions AS subscription
    JOIN public.billing_plans AS plan ON plan.code = subscription.plan_code
    WHERE subscription.tenant_id = candidate.tenant_id;

    tenant_budget := candidate.ai_monthly_budget_cents;
    effective_budget := CASE
      WHEN plan_budget IS NULL THEN tenant_budget
      ELSE least(tenant_budget::bigint, plan_budget)
    END;
    SELECT coalesce(sum(run.estimated_cost_cents), 0)
    INTO spent_this_month
    FROM public.ai_agent_runs AS run
    WHERE run.tenant_id = candidate.tenant_id
      AND run.created_at >= date_trunc('month', target_now);

    IF effective_budget <= spent_this_month THEN
      skipped_total := skipped_total + 1;
      CONTINUE;
    END IF;

    display_name := left(
      coalesce(
        nullif(
          regexp_replace(trim(candidate.first_name), '[[:cntrl:]]', '', 'g'),
          ''
        ),
        'there'
      ),
      100
    );
    outstanding_cents := candidate.total_cents - candidate.paid_cents;
    outstanding_display := format(
      '$%s.%s',
      outstanding_cents / 100,
      lpad((outstanding_cents % 100)::text, 2, '0')
    );

    IF candidate.invoice_status = 'paid' THEN
      message_kind := 'review_request';
      message_category := 'marketing';
      message_milestone := NULL;
      settled_time := candidate.settled_at;
      payment_source := candidate.payment_source;
      message_dedupe_key := format(
        'invoice:%s:review_request', candidate.invoice_id
      );
      message_subject := 'How was your service experience?';
      message_body := format(
        'Hi %s, thank you for your payment on invoice #%s. If you have a moment, we would appreciate your feedback about the service you received.',
        display_name, candidate.invoice_number
      );
    ELSE
      message_milestone := candidate.days_overdue;
      message_kind := CASE candidate.days_overdue
        WHEN 3 THEN 'overdue_3_day'::public.follow_up_message_kind
        WHEN 7 THEN 'overdue_7_day'::public.follow_up_message_kind
        ELSE 'overdue_14_day'::public.follow_up_message_kind
      END;
      message_category := 'transactional';
      settled_time := NULL;
      payment_source := coalesce(candidate.payment_source, 'manual');
      message_dedupe_key := format(
        'invoice:%s:overdue:%s', candidate.invoice_id, candidate.days_overdue
      );
      message_subject := format(
        'Invoice #%s payment reminder', candidate.invoice_number
      );
      message_body := CASE candidate.days_overdue
        WHEN 3 THEN format(
          'Hi %s, this is a friendly reminder that invoice #%s has an outstanding balance of %s. If payment is already in progress, please disregard this message.',
          display_name, candidate.invoice_number, outstanding_display
        )
        WHEN 7 THEN format(
          'Hi %s, invoice #%s remains unpaid with %s outstanding. Please review the invoice or contact the service business if you need assistance.',
          display_name, candidate.invoice_number, outstanding_display
        )
        ELSE format(
          'Hi %s, invoice #%s is now 14 days overdue with %s outstanding. Please arrange payment or contact the service business promptly to discuss the account.',
          display_name, candidate.invoice_number, outstanding_display
        )
      END;
    END IF;

    message_state := pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          concat_ws(
            '|', candidate.invoice_updated_at::text,
            candidate.customer_updated_at::text, message_kind::text,
            candidate.email, candidate.total_cents::text,
            candidate.paid_cents::text,
            coalesce(candidate.settled_at::text, ''),
            payment_source::text
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );

    INSERT INTO public.follow_up_messages (
      tenant_id, invoice_id, customer_id, kind, category, milestone_day,
      dedupe_key, to_email, subject, body, payment_state_source, settled_at,
      target_state_version, approval_id, status
    ) VALUES (
      candidate.tenant_id, candidate.invoice_id, candidate.customer_id,
      message_kind, message_category, message_milestone,
      message_dedupe_key, lower(candidate.email), message_subject, message_body,
      payment_source, settled_time, message_state,
      NULL, 'cancelled'
    )
    ON CONFLICT (tenant_id, dedupe_key) DO NOTHING
    RETURNING id INTO new_message_id;

    IF new_message_id IS NULL THEN
      skipped_total := skipped_total + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.ai_agent_runs (
      tenant_id, actor_user_id, agent_kind, policy_version, correlation_id,
      status, redacted_input_summary, completed_at
    ) VALUES (
      candidate.tenant_id, NULL, 'follow_up', 'follow-up-v1', gen_random_uuid(),
      'succeeded',
      format('Follow-Up evaluation for invoice %s milestone %s',
        candidate.invoice_id, message_kind),
      target_now
    ) RETURNING id INTO new_run_id;

    INSERT INTO public.ai_run_steps (
      tenant_id, run_id, sequence_number, step_kind, tool_name,
      redacted_summary, outcome, duration_ms
    ) VALUES (
      candidate.tenant_id, new_run_id, 1, 'contact_policy_validation',
      'follow_up.evaluate_invoice',
      'Validated invoice state, business-local milestone, contact preferences, suppression, and dedupe state.',
      'grounded', 0
    );

    INSERT INTO public.ai_approval_requests (
      tenant_id, run_id, action_kind, rationale, proposed_changes,
      consequences, target_entity_type, target_entity_id,
      target_state_version, requested_by_user_id
    ) VALUES (
      candidate.tenant_id, new_run_id, 'follow_up.queue_message',
      format(
        'Invoice %s reached the eligible %s milestone. Payment state source: %s. Contact policy and dedupe checks passed.',
        candidate.invoice_id, message_kind, payment_source
      ),
      jsonb_build_object(
        'message', jsonb_build_object(
          'from', NULL,
          'to', jsonb_build_object(
            'messageId', new_message_id,
            'kind', message_kind,
            'category', message_category,
            'to', lower(candidate.email),
            'subject', message_subject,
            'body', message_body,
            'paymentStateSource', payment_source,
            'dedupeKey', message_dedupe_key
          )
        )
      ),
      'Approval makes this exact message ready for a separately configured email worker. It does not send email by itself.',
      'follow_up_message', new_message_id, message_state, NULL
    ) RETURNING id INTO new_approval_id;

    UPDATE public.follow_up_messages AS queued
    SET approval_id = new_approval_id, status = 'awaiting_approval'
    WHERE queued.id = new_message_id;

    INSERT INTO public.ai_run_steps (
      tenant_id, run_id, sequence_number, step_kind, tool_name,
      redacted_summary, outcome, duration_ms
    ) VALUES (
      candidate.tenant_id, new_run_id, 2, 'approval_requested',
      'follow_up.queue_message',
      'Created mandatory office approval for one exact deduplicated message; no email was sent.',
      'pending_approval', 0
    );

    INSERT INTO public.audit_events (
      tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
      candidate.tenant_id, NULL, 'ai.follow_up_proposed',
      'follow_up_message', new_message_id,
      jsonb_build_object(
        'run_id', new_run_id, 'approval_id', new_approval_id,
        'invoice_id', candidate.invoice_id, 'kind', message_kind,
        'payment_state_source', payment_source
      )
    );
    proposed_total := proposed_total + 1;
    new_message_id := NULL;
  END LOOP;

  RETURN QUERY SELECT proposed_total, skipped_total;
END;
$$;

REVOKE ALL ON FUNCTION public.run_follow_up_scheduler(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_follow_up_scheduler(timestamptz)
  TO service_role;

CREATE FUNCTION public.execute_approved_follow_up_message(
  target_approval_id uuid
)
RETURNS TABLE (
  execution_result text,
  message_id uuid,
  result_message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  approval public.ai_approval_requests%ROWTYPE;
  message public.follow_up_messages%ROWTYPE;
  invoice public.invoices%ROWTYPE;
  customer public.customers%ROWTYPE;
  current_settled_at timestamptz;
  current_payment_source public.payment_source;
  current_state text;
  local_age integer;
  next_step_number integer;
  rejection_message text;
  has_full_access boolean;
BEGIN
  SELECT request.* INTO approval
  FROM public.ai_approval_requests AS request
  WHERE request.id = target_approval_id
  FOR UPDATE;

  IF approval.id IS NULL OR NOT public.current_user_has_tenant_role(
    approval.tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'approval not found or unavailable' USING ERRCODE = '42501';
  END IF;
  IF approval.action_kind <> 'follow_up.queue_message'
    OR approval.target_entity_type <> 'follow_up_message'
    OR approval.target_entity_id IS NULL THEN
    RAISE EXCEPTION 'approval is not a Follow-Up message queue action'
      USING ERRCODE = '22023';
  END IF;
  IF approval.status <> 'approved' THEN
    RAISE EXCEPTION 'Follow-Up message queue requires an approved request'
      USING ERRCODE = 'P0001';
  END IF;
  IF approval.execution_status IS NOT NULL THEN
    RETURN QUERY SELECT
      approval.execution_status, approval.target_entity_id,
      approval.execution_message;
    RETURN;
  END IF;

  SELECT queued.* INTO message
  FROM public.follow_up_messages AS queued
  WHERE queued.id = approval.target_entity_id
    AND queued.tenant_id = approval.tenant_id
  FOR UPDATE;
  SELECT inv.* INTO invoice
  FROM public.invoices AS inv
  WHERE inv.id = message.invoice_id AND inv.tenant_id = message.tenant_id
  FOR UPDATE;
  SELECT contact.* INTO customer
  FROM public.customers AS contact
  WHERE contact.id = message.customer_id
    AND contact.tenant_id = message.tenant_id;

  SELECT subscription.access_mode = 'full' INTO has_full_access
  FROM public.tenant_subscriptions AS subscription
  WHERE subscription.tenant_id = approval.tenant_id;

  IF NOT coalesce(has_full_access, false) THEN
    rejection_message :=
      'Subscription access is no longer full. The message was not queued.';
    UPDATE public.follow_up_messages
    SET status = 'cancelled', last_error_code = 'subscription_access'
    WHERE id = message.id;
    UPDATE public.ai_approval_requests
    SET execution_status = 'rejected_policy', executed_at = now(),
        executed_by_user_id = auth.uid(), execution_message = rejection_message
    WHERE id = approval.id;
  ELSE
    SELECT record.received_at, record.source
    INTO current_settled_at, current_payment_source
    FROM public.payment_records AS record
    WHERE record.invoice_id = invoice.id
      AND record.tenant_id = invoice.tenant_id
      AND record.record_type = 'payment'
      AND record.amount_cents > 0
    ORDER BY record.received_at DESC, record.id DESC
    LIMIT 1;
    current_payment_source := coalesce(current_payment_source, 'manual');

    current_state := pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          concat_ws(
            '|', invoice.updated_at::text, customer.updated_at::text,
            message.kind::text, customer.email, invoice.total_cents::text,
            invoice.paid_cents::text,
            coalesce(current_settled_at::text, ''), current_payment_source::text
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );

    IF message.kind = 'review_request' THEN
      local_age := (now() AT TIME ZONE (
        SELECT time_zone FROM public.tenants WHERE id = message.tenant_id
      ))::date - (current_settled_at AT TIME ZONE (
        SELECT time_zone FROM public.tenants WHERE id = message.tenant_id
      ))::date;
    ELSE
      local_age := (now() AT TIME ZONE (
        SELECT time_zone FROM public.tenants WHERE id = message.tenant_id
      ))::date - (invoice.due_at AT TIME ZONE (
        SELECT time_zone FROM public.tenants WHERE id = message.tenant_id
      ))::date;
    END IF;

    IF message.id IS NULL
      OR message.status <> 'awaiting_approval'
      OR message.approval_id IS DISTINCT FROM approval.id
      OR invoice.id IS NULL
      OR customer.id IS NULL
      OR customer.archived_at IS NOT NULL
      OR customer.email_suppressed_at IS NOT NULL
      OR lower(customer.email) IS DISTINCT FROM message.to_email
      OR NOT customer.transactional_email_allowed
      OR current_state IS DISTINCT FROM approval.target_state_version
      OR current_state IS DISTINCT FROM message.target_state_version
      OR approval.proposed_changes #>> '{message,to,messageId}'
        IS DISTINCT FROM message.id::text
      OR approval.proposed_changes #>> '{message,to,dedupeKey}'
        IS DISTINCT FROM message.dedupe_key
      OR approval.proposed_changes #>> '{message,to,kind}'
        IS DISTINCT FROM message.kind::text
      OR approval.proposed_changes #>> '{message,to,category}'
        IS DISTINCT FROM message.category::text
      OR approval.proposed_changes #>> '{message,to,to}'
        IS DISTINCT FROM message.to_email
      OR approval.proposed_changes #>> '{message,to,subject}'
        IS DISTINCT FROM message.subject
      OR approval.proposed_changes #>> '{message,to,body}'
        IS DISTINCT FROM message.body
      OR approval.proposed_changes #>> '{message,to,paymentStateSource}'
        IS DISTINCT FROM message.payment_state_source::text
      OR (
        message.kind = 'review_request'
        AND (
          invoice.status <> 'paid'
          OR invoice.paid_cents <> invoice.total_cents
          OR NOT customer.marketing_email_opted_in
          OR current_settled_at IS DISTINCT FROM message.settled_at
          OR local_age < 2
        )
      )
      OR (
        message.kind <> 'review_request'
        AND (
          invoice.status NOT IN ('sent', 'partially_paid')
          OR invoice.paid_cents >= invoice.total_cents
          OR local_age < message.milestone_day
        )
      ) THEN
      rejection_message :=
        'Invoice, payment, contact, preference, suppression, or message state changed. The message was not queued.';
      UPDATE public.follow_up_messages
      SET status = 'cancelled', last_error_code = 'stale_follow_up_state'
      WHERE id = message.id;
      UPDATE public.ai_approval_requests
      SET execution_status = 'rejected_stale', executed_at = now(),
          executed_by_user_id = auth.uid(), execution_message = rejection_message
      WHERE id = approval.id;
    ELSE
      UPDATE public.follow_up_messages
      SET status = 'ready', ready_at = now(), next_attempt_at = now(),
          last_error_code = NULL
      WHERE id = message.id;
      UPDATE public.ai_approval_requests
      SET execution_status = 'succeeded', executed_at = now(),
          executed_by_user_id = auth.uid(),
          execution_message =
            'Approved Follow-Up message is ready for a configured delivery worker; no email was sent by approval execution.'
      WHERE id = approval.id;
      rejection_message :=
        'Approved Follow-Up message queued safely. Email delivery remains provider-controlled.';
    END IF;
  END IF;

  SELECT coalesce(max(step.sequence_number), 0) + 1 INTO next_step_number
  FROM public.ai_run_steps AS step WHERE step.run_id = approval.run_id;
  INSERT INTO public.ai_run_steps (
    tenant_id, run_id, sequence_number, step_kind, tool_name,
    redacted_summary, outcome, duration_ms
  ) VALUES (
    approval.tenant_id, approval.run_id, next_step_number,
    'guarded_execution', 'follow_up.queue_message', rejection_message,
    (SELECT execution_status FROM public.ai_approval_requests WHERE id = approval.id),
    0
  );
  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    approval.tenant_id, auth.uid(),
    CASE
      WHEN (SELECT execution_status FROM public.ai_approval_requests WHERE id = approval.id) = 'succeeded'
        THEN 'ai.follow_up_queued'
      ELSE 'ai.follow_up_execution_rejected'
    END,
    'follow_up_message', message.id,
    jsonb_build_object(
      'approval_id', approval.id, 'run_id', approval.run_id,
      'invoice_id', message.invoice_id,
      'execution_status', (
        SELECT execution_status FROM public.ai_approval_requests WHERE id = approval.id
      )
    )
  );

  RETURN QUERY SELECT
    (SELECT execution_status FROM public.ai_approval_requests WHERE id = approval.id),
    message.id, rejection_message;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_approved_follow_up_message(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_approved_follow_up_message(uuid)
  TO authenticated;

DO $$
DECLARE existing_job_id bigint;
BEGIN
  SELECT jobid INTO existing_job_id
  FROM cron.job WHERE jobname = 'crewflow-follow-up-daily' LIMIT 1;
  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;
  PERFORM cron.schedule(
    'crewflow-follow-up-daily',
    '15 14 * * *',
    'SELECT public.run_follow_up_scheduler(now());'
  );
END;
$$;

COMMENT ON TABLE public.follow_up_messages IS
  'Provider-neutral deduplicated Follow-Up approval and delivery queue. Ready does not mean delivered.';
COMMENT ON FUNCTION public.run_follow_up_scheduler(timestamptz) IS
  'Daily service-only 3/7/14-day reminder and opted-in two-day review proposal scheduler.';
COMMENT ON FUNCTION public.execute_approved_follow_up_message(uuid) IS
  'Revalidates and makes one approved exact Follow-Up message ready without sending email.';
