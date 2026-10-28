-- CrewFlow Phase 7: opt-in transactional email for team invitations, quotes,
-- and invoices. Callers supply only a kind, an entity id, and the one-time
-- link token they just received; the database verifies the token hash,
-- derives the recipient, and renders the content. The raw link is held in a
-- service-only queue until a terminal state, then scrubbed. The worker builds
-- the absolute URL from a server-side origin so content cannot be redirected.

CREATE TYPE public.transactional_email_kind AS ENUM (
  'team_invitation',
  'quote',
  'invoice'
);

CREATE TABLE public.transactional_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  kind public.transactional_email_kind NOT NULL,
  entity_id uuid NOT NULL,
  token_hash text NOT NULL,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  link_path text,
  status text NOT NULL DEFAULT 'ready',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  provider_message_id text,
  delivered_at timestamptz,
  requested_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transactional_emails_one_per_link UNIQUE (tenant_id, kind, token_hash),
  CONSTRAINT transactional_emails_status_check CHECK (
    status IN ('ready', 'processing', 'delivered', 'failed', 'cancelled')
  ),
  CONSTRAINT transactional_emails_token_hash_format CHECK (
    token_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT transactional_emails_email_length CHECK (
    char_length(to_email) BETWEEN 3 AND 320
  ),
  CONSTRAINT transactional_emails_content_bounds CHECK (
    char_length(subject) BETWEEN 1 AND 240
    AND char_length(body) BETWEEN 1 AND 4000
    AND position('{{link}}' IN body) > 0
  ),
  CONSTRAINT transactional_emails_link_shape CHECK (
    link_path IS NULL
    OR link_path ~ '^/(quote/|invoice/|signup\?next=%2Finvite%2F)[0-9a-f]{64}$'
  ),
  CONSTRAINT transactional_emails_link_lifecycle CHECK (
    (status IN ('ready', 'processing') AND link_path IS NOT NULL)
    OR (status IN ('delivered', 'failed', 'cancelled') AND link_path IS NULL)
  ),
  CONSTRAINT transactional_emails_lease_shape CHECK (
    (status = 'processing' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'processing' AND lease_token IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT transactional_emails_attempt_bounds CHECK (
    attempt_count BETWEEN 0 AND 5
  ),
  CONSTRAINT transactional_emails_error_length CHECK (
    last_error_code IS NULL OR char_length(last_error_code) BETWEEN 1 AND 80
  ),
  CONSTRAINT transactional_emails_provider_id_length CHECK (
    provider_message_id IS NULL OR char_length(provider_message_id) <= 200
  )
);

CREATE INDEX transactional_emails_claim_idx
  ON public.transactional_emails (status, next_attempt_at, id)
  WHERE status IN ('ready', 'processing');

CREATE TRIGGER transactional_emails_updated_at
BEFORE UPDATE ON public.transactional_emails
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER transactional_emails_tenant_immutable
BEFORE UPDATE ON public.transactional_emails
FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_change();

ALTER TABLE public.transactional_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.transactional_emails FROM anon, authenticated;

-- True while the linked document is still sendable under the same token and
-- the recipient may still be emailed.
CREATE FUNCTION public.transactional_email_is_current(
  target_kind public.transactional_email_kind,
  target_entity_id uuid,
  target_tenant_id uuid,
  target_token_hash text,
  target_email text
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE target_kind
    WHEN 'quote' THEN EXISTS (
      SELECT 1
      FROM public.quotes AS quote
      JOIN public.customers AS customer
        ON customer.id = quote.customer_id AND customer.tenant_id = quote.tenant_id
      WHERE quote.id = target_entity_id
        AND quote.tenant_id = target_tenant_id
        AND quote.status = 'sent'
        AND quote.expires_at > now()
        AND quote.decision_token_hash = target_token_hash
        AND customer.archived_at IS NULL
        AND customer.email_suppressed_at IS NULL
        AND customer.transactional_email_allowed
        AND lower(customer.email) = target_email
    )
    WHEN 'invoice' THEN EXISTS (
      SELECT 1
      FROM public.invoices AS invoice
      JOIN public.customers AS customer
        ON customer.id = invoice.customer_id AND customer.tenant_id = invoice.tenant_id
      WHERE invoice.id = target_entity_id
        AND invoice.tenant_id = target_tenant_id
        AND invoice.status IN ('sent', 'partially_paid')
        AND invoice.paid_cents < invoice.total_cents
        AND invoice.public_token_hash = target_token_hash
        AND customer.archived_at IS NULL
        AND customer.email_suppressed_at IS NULL
        AND customer.transactional_email_allowed
        AND lower(customer.email) = target_email
    )
    WHEN 'team_invitation' THEN EXISTS (
      SELECT 1
      FROM public.team_invitations AS invitation
      WHERE invitation.id = target_entity_id
        AND invitation.tenant_id = target_tenant_id
        AND invitation.token_hash = target_token_hash
        AND invitation.accepted_at IS NULL
        AND invitation.revoked_at IS NULL
        AND invitation.expires_at > now()
        AND invitation.email = target_email
    )
    ELSE false
  END;
$$;

CREATE FUNCTION public.enqueue_transactional_email(
  target_kind public.transactional_email_kind,
  target_entity_id uuid,
  link_token text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  hashed text;
  email_tenant_id uuid;
  allowed_roles public.membership_role[];
  recipient text;
  greeting_name text;
  amount_cents bigint;
  currency text;
  deadline timestamptz;
  document_number bigint;
  invited_role text;
  business_name text;
  business_time_zone text;
  money_text text;
  date_text text;
  email_subject text;
  email_body text;
  email_link_path text;
  queued_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF target_kind IS NULL OR target_entity_id IS NULL
    OR link_token IS NULL OR link_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'email link is invalid' USING ERRCODE = '22023';
  END IF;

  hashed := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(link_token, 'UTF8'), 'sha256'),
    'hex'
  );

  IF target_kind = 'quote' THEN
    SELECT quote.tenant_id, lower(customer.email), customer.first_name,
      quote.total_cents, quote.currency_code, quote.expires_at
    INTO email_tenant_id, recipient, greeting_name, amount_cents, currency, deadline
    FROM public.quotes AS quote
    JOIN public.customers AS customer
      ON customer.id = quote.customer_id AND customer.tenant_id = quote.tenant_id
    WHERE quote.id = target_entity_id AND quote.decision_token_hash = hashed;
    allowed_roles := ARRAY['owner', 'office']::public.membership_role[];
    email_link_path := '/quote/' || link_token;
  ELSIF target_kind = 'invoice' THEN
    SELECT invoice.tenant_id, lower(customer.email), customer.first_name,
      invoice.total_cents - invoice.paid_cents, invoice.currency_code,
      invoice.due_at, invoice.invoice_number
    INTO email_tenant_id, recipient, greeting_name, amount_cents, currency,
      deadline, document_number
    FROM public.invoices AS invoice
    JOIN public.customers AS customer
      ON customer.id = invoice.customer_id AND customer.tenant_id = invoice.tenant_id
    WHERE invoice.id = target_entity_id AND invoice.public_token_hash = hashed;
    allowed_roles := ARRAY['owner', 'office']::public.membership_role[];
    email_link_path := '/invoice/' || link_token;
  ELSE
    SELECT invitation.tenant_id, invitation.email, invitation.role::text,
      invitation.expires_at
    INTO email_tenant_id, recipient, invited_role, deadline
    FROM public.team_invitations AS invitation
    WHERE invitation.id = target_entity_id AND invitation.token_hash = hashed;
    allowed_roles := ARRAY['owner']::public.membership_role[];
    email_link_path := '/signup?next=%2Finvite%2F' || link_token;
  END IF;

  IF email_tenant_id IS NULL
    OR NOT public.current_user_has_tenant_role(email_tenant_id, allowed_roles) THEN
    RAISE EXCEPTION 'email target is unavailable' USING ERRCODE = '42501';
  END IF;
  IF NOT public.transactional_email_is_current(
    target_kind, target_entity_id, email_tenant_id, hashed, coalesce(recipient, '')
  ) THEN
    RAISE EXCEPTION 'recipient cannot be emailed' USING ERRCODE = '22023';
  END IF;

  SELECT regexp_replace(tenant.display_name, '[[:cntrl:]]', '', 'g'),
    tenant.time_zone
  INTO business_name, business_time_zone
  FROM public.tenants AS tenant
  WHERE tenant.id = email_tenant_id;

  date_text := to_char(deadline AT TIME ZONE business_time_zone, 'FMMonth FMDD, YYYY');
  money_text := CASE WHEN currency = 'USD' THEN '$' ELSE currency || ' ' END
    || to_char(amount_cents / 100.0, 'FM999,999,999,990.00');
  greeting_name := regexp_replace(coalesce(greeting_name, ''), '[[:cntrl:]]', '', 'g');

  IF target_kind = 'quote' THEN
    email_subject := format('Your quote from %s', business_name);
    email_body := format(
      E'Hi %s,\n\n%s has sent you a quote for %s. Review it and accept or decline here:\n\n{{link}}\n\nThis link expires on %s. Reply to this email to reach %s directly.\n\nSent by CrewFlow on behalf of %s.',
      greeting_name, business_name, money_text, date_text, business_name, business_name
    );
  ELSIF target_kind = 'invoice' THEN
    email_subject := format('Invoice #%s from %s', document_number, business_name);
    email_body := format(
      E'Hi %s,\n\n%s has sent you invoice #%s. Amount due: %s, due %s.\n\nView the invoice and payment options here:\n\n{{link}}\n\nReply to this email to reach %s directly.\n\nSent by CrewFlow on behalf of %s.',
      greeting_name, business_name, document_number, money_text, date_text,
      business_name, business_name
    );
  ELSE
    email_subject := format('%s invited you to CrewFlow', business_name);
    email_body := format(
      E'Hello,\n\n%s invited you to join their CrewFlow workspace as %s. Create your account and accept the invitation here:\n\n{{link}}\n\nThis invitation expires on %s. If you were not expecting it, you can ignore this email.\n\nSent by CrewFlow on behalf of %s.',
      business_name, invited_role, date_text, business_name
    );
  END IF;

  INSERT INTO public.transactional_emails (
    tenant_id, kind, entity_id, token_hash, to_email, subject, body,
    link_path, requested_by_user_id
  ) VALUES (
    email_tenant_id, target_kind, target_entity_id, hashed, recipient,
    left(email_subject, 240), email_body, email_link_path, auth.uid()
  )
  ON CONFLICT (tenant_id, kind, token_hash) DO NOTHING
  RETURNING id INTO queued_id;

  -- Requesting the same link twice is idempotent.
  IF queued_id IS NULL THEN
    SELECT email.id INTO queued_id
    FROM public.transactional_emails AS email
    WHERE email.tenant_id = email_tenant_id
      AND email.kind = target_kind
      AND email.token_hash = hashed;
    RETURN queued_id;
  END IF;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    email_tenant_id, auth.uid(), 'email.requested', target_kind::text,
    target_entity_id, jsonb_build_object('email_id', queued_id)
  );

  RETURN queued_id;
END;
$$;

CREATE FUNCTION public.claim_transactional_emails(
  target_batch_size integer DEFAULT 10
)
RETURNS TABLE (
  email_id uuid,
  lease_token uuid,
  to_email text,
  subject text,
  body text,
  link_path text,
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

  UPDATE public.transactional_emails AS email
  SET status = 'failed',
      link_path = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      next_attempt_at = NULL,
      last_error_code = 'delivery_lease_expired'
  WHERE email.status = 'processing'
    AND email.lease_expires_at < now()
    AND email.attempt_count >= 5;

  UPDATE public.transactional_emails AS email
  SET status = 'cancelled',
      link_path = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      next_attempt_at = NULL,
      last_error_code = 'stale_email_state'
  WHERE (
      email.status = 'ready'
      OR (email.status = 'processing' AND email.lease_expires_at < now())
    )
    AND NOT public.transactional_email_is_current(
      email.kind, email.entity_id, email.tenant_id, email.token_hash, email.to_email
    );

  RETURN QUERY
  WITH candidates AS (
    SELECT email.id
    FROM public.transactional_emails AS email
    WHERE email.attempt_count < 5
      AND (
        (email.status = 'ready' AND email.next_attempt_at <= now())
        OR (email.status = 'processing' AND email.lease_expires_at < now())
      )
    ORDER BY email.next_attempt_at NULLS FIRST, email.id
    FOR UPDATE OF email SKIP LOCKED
    LIMIT target_batch_size
  ), claimed AS (
    UPDATE public.transactional_emails AS email
    SET status = 'processing',
        attempt_count = email.attempt_count + 1,
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + interval '2 minutes',
        last_error_code = NULL
    FROM candidates
    WHERE email.id = candidates.id
    RETURNING email.id, email.tenant_id, email.lease_token, email.to_email,
      email.subject, email.body, email.link_path
  )
  SELECT claimed.id, claimed.lease_token, claimed.to_email, claimed.subject,
    claimed.body, claimed.link_path, tenant.display_name, tenant.business_email
  FROM claimed
  JOIN public.tenants AS tenant ON tenant.id = claimed.tenant_id;
END;
$$;

CREATE FUNCTION public.complete_transactional_email(
  target_email_id uuid,
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

  UPDATE public.transactional_emails
  SET status = 'delivered',
      delivered_at = now(),
      provider_message_id = target_provider_message_id,
      link_path = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      next_attempt_at = NULL,
      last_error_code = NULL
  WHERE id = target_email_id
    AND status = 'processing'
    AND lease_token = target_lease_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'email delivery lease is invalid' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE FUNCTION public.retry_transactional_email(
  target_email_id uuid,
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
  locked_email public.transactional_emails%ROWTYPE;
  next_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF target_error_code IS NULL OR target_error_code !~ '^[a-z0-9_]{3,80}$' THEN
    RAISE EXCEPTION 'bounded email delivery error code required'
      USING ERRCODE = '22023';
  END IF;

  SELECT email.* INTO locked_email
  FROM public.transactional_emails AS email
  WHERE email.id = target_email_id
    AND email.status = 'processing'
    AND email.lease_token = target_lease_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'email delivery lease is invalid' USING ERRCODE = '42501';
  END IF;

  next_status := CASE
    WHEN coalesce(target_permanent, false) OR locked_email.attempt_count >= 5
      THEN 'failed'
    ELSE 'ready'
  END;

  UPDATE public.transactional_emails
  SET status = next_status,
      link_path = CASE WHEN next_status = 'ready' THEN link_path ELSE NULL END,
      next_attempt_at = CASE
        WHEN next_status = 'ready' THEN now() + make_interval(
          mins => least(240, 5 * (2 ^ greatest(0, locked_email.attempt_count - 1))::integer)
        )
        ELSE NULL
      END,
      lease_token = NULL,
      lease_expires_at = NULL,
      last_error_code = target_error_code
  WHERE id = locked_email.id;

  RETURN next_status;
END;
$$;

-- Provider suppression now also cancels queued document and invitation mail.
CREATE OR REPLACE FUNCTION public.record_provider_email_suppression(
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

  UPDATE public.transactional_emails
  SET status = 'cancelled',
      link_path = NULL,
      next_attempt_at = NULL,
      last_error_code = 'recipient_suppressed'
  WHERE to_email = normalized_email
    AND status = 'ready';

  RETURN suppressed_customers;
END;
$$;

CREATE FUNCTION public.configure_transactional_email_cron()
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
  WHERE jobname = 'crewflow-deliver-transactional-email' LIMIT 1;
  IF existing_job_id IS NOT NULL THEN PERFORM cron.unschedule(existing_job_id); END IF;

  SELECT cron.schedule(
    'crewflow-deliver-transactional-email', '* * * * *',
    $command$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'crewflow_project_url') ||
          '/functions/v1/process-transactional-emails',
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

-- As with Follow-Up delivery, live sending starts only when an operator calls
-- configure_transactional_email_cron() after the sending domain is verified.

REVOKE ALL ON FUNCTION public.transactional_email_is_current(
  public.transactional_email_kind, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_transactional_email(
  public.transactional_email_kind, uuid, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_transactional_email(
  public.transactional_email_kind, uuid, text
) TO authenticated;
REVOKE ALL ON FUNCTION public.claim_transactional_emails(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_transactional_emails(integer)
  TO service_role;
REVOKE ALL ON FUNCTION public.complete_transactional_email(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_transactional_email(uuid, uuid, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.retry_transactional_email(uuid, uuid, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retry_transactional_email(uuid, uuid, text, boolean)
  TO service_role;
REVOKE ALL ON FUNCTION public.configure_transactional_email_cron()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_transactional_email_cron()
  TO service_role;

COMMENT ON TABLE public.transactional_emails IS
  'Service-only queue of opt-in invitation, quote, and invoice email. Link tokens are scrubbed at every terminal state.';
COMMENT ON FUNCTION public.enqueue_transactional_email(
  public.transactional_email_kind, uuid, text
) IS
  'Owner/office request to email a just-issued link. Verifies the token hash, derives the recipient, and renders content server-side.';
