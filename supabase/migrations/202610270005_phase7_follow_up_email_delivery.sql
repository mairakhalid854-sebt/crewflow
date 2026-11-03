-- CrewFlow Phase 7: provider delivery for approved transactional Follow-Up email.
-- Only ready transactional messages are claimed. Marketing review requests stay
-- held until an unsubscribe flow and counsel approval exist. Contact and
-- invoice state are revalidated at claim time, and provider bounces or
-- complaints suppress the recipient.

ALTER TABLE public.follow_up_messages
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_expires_at timestamptz,
  ADD CONSTRAINT follow_up_messages_lease_shape CHECK (
    (status = 'processing' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'processing' AND lease_token IS NULL AND lease_expires_at IS NULL)
  );

CREATE INDEX follow_up_messages_email_claim_idx
  ON public.follow_up_messages (status, next_attempt_at, id)
  WHERE category = 'transactional' AND status IN ('ready', 'processing');

CREATE FUNCTION public.claim_follow_up_email_deliveries(
  target_batch_size integer DEFAULT 10
)
RETURNS TABLE (
  message_id uuid,
  lease_token uuid,
  to_email text,
  subject text,
  body text,
  sender_name text,
  reply_to_email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF target_batch_size NOT BETWEEN 1 AND 25 THEN
    RAISE EXCEPTION 'email delivery batch size is invalid' USING ERRCODE = '22023';
  END IF;

  -- A crashed worker cannot hold a message forever; exhausted leases fail.
  UPDATE public.follow_up_messages AS message
  SET status = 'failed',
      lease_token = NULL,
      lease_expires_at = NULL,
      next_attempt_at = NULL,
      last_error_code = 'delivery_lease_expired'
  WHERE message.status = 'processing'
    AND message.lease_expires_at < now()
    AND message.attempt_count >= 5;

  -- Approval was granted against earlier state. Never send to a suppressed,
  -- archived, changed, or opted-out contact, or for an invoice that is no
  -- longer overdue.
  UPDATE public.follow_up_messages AS message
  SET status = 'cancelled',
      lease_token = NULL,
      lease_expires_at = NULL,
      next_attempt_at = NULL,
      last_error_code = 'stale_follow_up_state'
  FROM public.customers AS customer, public.invoices AS invoice
  WHERE customer.id = message.customer_id
    AND customer.tenant_id = message.tenant_id
    AND invoice.id = message.invoice_id
    AND invoice.tenant_id = message.tenant_id
    AND message.category = 'transactional'
    AND (
      message.status = 'ready'
      OR (message.status = 'processing' AND message.lease_expires_at < now())
    )
    AND (
      customer.archived_at IS NOT NULL
      OR customer.email_suppressed_at IS NOT NULL
      OR lower(customer.email) IS DISTINCT FROM message.to_email
      OR NOT customer.transactional_email_allowed
      OR invoice.status NOT IN ('sent', 'partially_paid')
      OR invoice.paid_cents >= invoice.total_cents
    );

  RETURN QUERY
  WITH candidates AS (
    SELECT message.id
    FROM public.follow_up_messages AS message
    WHERE message.category = 'transactional'
      AND message.attempt_count < 5
      AND (
        (message.status = 'ready' AND message.next_attempt_at <= now())
        OR (message.status = 'processing' AND message.lease_expires_at < now())
      )
    ORDER BY message.next_attempt_at NULLS FIRST, message.id
    FOR UPDATE OF message SKIP LOCKED
    LIMIT target_batch_size
  ), claimed AS (
    UPDATE public.follow_up_messages AS message
    SET status = 'processing',
        attempt_count = message.attempt_count + 1,
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + interval '2 minutes',
        last_error_code = NULL
    FROM candidates
    WHERE message.id = candidates.id
    RETURNING message.id, message.tenant_id, message.lease_token,
      message.to_email, message.subject, message.body
  )
  SELECT claimed.id, claimed.lease_token, claimed.to_email, claimed.subject,
    claimed.body, tenant.display_name, tenant.business_email
  FROM claimed
  JOIN public.tenants AS tenant ON tenant.id = claimed.tenant_id;
END;
$$;

CREATE FUNCTION public.complete_follow_up_email_delivery(
  target_message_id uuid,
  target_lease_token uuid,
  target_provider_message_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF target_provider_message_id IS NULL
    OR target_provider_message_id !~ '^[A-Za-z0-9._:-]{1,200}$' THEN
    RAISE EXCEPTION 'bounded provider message id required' USING ERRCODE = '22023';
  END IF;

  -- The provider already accepted the message, so an expired but unreclaimed
  -- lease still completes. A reclaimed lease has a new token and is rejected.
  UPDATE public.follow_up_messages
  SET status = 'delivered',
      delivered_at = now(),
      provider_message_id = target_provider_message_id,
      lease_token = NULL,
      lease_expires_at = NULL,
      next_attempt_at = NULL,
      last_error_code = NULL
  WHERE id = target_message_id
    AND status = 'processing'
    AND lease_token = target_lease_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'email delivery lease is invalid' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE FUNCTION public.retry_follow_up_email_delivery(
  target_message_id uuid,
  target_lease_token uuid,
  target_error_code text,
  target_permanent boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  locked_message public.follow_up_messages%ROWTYPE;
  next_status public.follow_up_delivery_status;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF target_error_code IS NULL OR target_error_code !~ '^[a-z0-9_]{3,80}$' THEN
    RAISE EXCEPTION 'bounded email delivery error code required'
      USING ERRCODE = '22023';
  END IF;

  SELECT message.* INTO locked_message
  FROM public.follow_up_messages AS message
  WHERE message.id = target_message_id
    AND message.status = 'processing'
    AND message.lease_token = target_lease_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'email delivery lease is invalid' USING ERRCODE = '42501';
  END IF;

  next_status := CASE
    WHEN coalesce(target_permanent, false) OR locked_message.attempt_count >= 5
      THEN 'failed'::public.follow_up_delivery_status
    ELSE 'ready'::public.follow_up_delivery_status
  END;

  UPDATE public.follow_up_messages
  SET status = next_status,
      next_attempt_at = CASE
        WHEN next_status = 'ready' THEN now() + make_interval(
          mins => least(240, 5 * (2 ^ greatest(0, locked_message.attempt_count - 1))::integer)
        )
        ELSE NULL
      END,
      lease_token = NULL,
      lease_expires_at = NULL,
      last_error_code = target_error_code
  WHERE id = locked_message.id;

  RETURN next_status::text;
END;
$$;

CREATE FUNCTION public.record_provider_email_suppression(
  target_email text,
  target_reason text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  normalized_email text := lower(btrim(coalesce(target_email, '')));
  suppressed_customers integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF target_reason IS NULL OR target_reason NOT IN ('hard_bounce', 'complaint') THEN
    RAISE EXCEPTION 'email suppression reason is invalid' USING ERRCODE = '22023';
  END IF;
  IF char_length(normalized_email) NOT BETWEEN 3 AND 320
    OR normalized_email !~ '^[^@\s]+@[^@\s]+$' THEN
    RAISE EXCEPTION 'email suppression address is invalid' USING ERRCODE = '22023';
  END IF;

  -- All tenants share the CrewFlow sending domain and the provider suppresses
  -- the address for every sender, so the local suppression is global too.
  UPDATE public.customers
  SET email_suppressed_at = now(),
      email_suppression_reason = CASE target_reason
        WHEN 'hard_bounce' THEN 'Email provider reported a permanent bounce.'
        ELSE 'Recipient reported a CrewFlow email as spam.'
      END
  WHERE lower(email) = normalized_email
    AND email_suppressed_at IS NULL;
  GET DIAGNOSTICS suppressed_customers = ROW_COUNT;

  UPDATE public.follow_up_messages
  SET status = 'cancelled',
      next_attempt_at = NULL,
      last_error_code = 'recipient_suppressed'
  WHERE to_email = normalized_email
    AND status = 'ready';

  RETURN suppressed_customers;
END;
$$;

CREATE FUNCTION public.configure_follow_up_email_delivery_cron()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE existing_job_id bigint; scheduled_job_id bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND current_user <> 'postgres' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'crewflow_project_url')
    OR NOT EXISTS (
      SELECT 1 FROM vault.secrets
      WHERE name = 'crewflow_edge_function_service_key'
    ) THEN
    RAISE EXCEPTION 'shared CrewFlow cron secrets are not configured'
      USING ERRCODE = '55000';
  END IF;

  SELECT jobid INTO existing_job_id FROM cron.job
  WHERE jobname = 'crewflow-deliver-follow-up-email' LIMIT 1;
  IF existing_job_id IS NOT NULL THEN PERFORM cron.unschedule(existing_job_id); END IF;

  SELECT cron.schedule(
    'crewflow-deliver-follow-up-email', '*/2 * * * *',
    $command$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'crewflow_project_url') ||
          '/functions/v1/process-follow-up-email-deliveries',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'crewflow_edge_function_service_key')
        ),
        body := jsonb_build_object('scheduled_at', now()),
        timeout_milliseconds := 45000
      ) AS request_id;
    $command$
  ) INTO scheduled_job_id;
  RETURN scheduled_job_id;
END;
$$;

-- Unlike the AI review worker, delivery is never scheduled by migration: live
-- sending starts only after the sending domain is verified and an operator
-- calls configure_follow_up_email_delivery_cron() explicitly.

REVOKE ALL ON FUNCTION public.claim_follow_up_email_deliveries(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_follow_up_email_deliveries(integer)
  TO service_role;
REVOKE ALL ON FUNCTION public.complete_follow_up_email_delivery(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_follow_up_email_delivery(uuid, uuid, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.retry_follow_up_email_delivery(uuid, uuid, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retry_follow_up_email_delivery(uuid, uuid, text, boolean)
  TO service_role;
REVOKE ALL ON FUNCTION public.record_provider_email_suppression(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_provider_email_suppression(text, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.configure_follow_up_email_delivery_cron()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_follow_up_email_delivery_cron()
  TO service_role;

COMMENT ON FUNCTION public.claim_follow_up_email_deliveries(integer) IS
  'Service-only lease of ready transactional Follow-Up email after revalidating contact and invoice state. Marketing messages are never claimed.';
COMMENT ON FUNCTION public.record_provider_email_suppression(text, text) IS
  'Service-only suppression from verified provider bounce/complaint webhooks.';
