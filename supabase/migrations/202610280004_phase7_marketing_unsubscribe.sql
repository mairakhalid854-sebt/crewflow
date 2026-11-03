-- CrewFlow Phase 7: CAN-SPAM prerequisites for marketing review requests.
-- Unsubscribe links are stateless HMAC signatures over the customer id using a
-- Vault-held key, so no token is stored. Marketing mail is claimed only when
-- the worker explicitly asks (an operator switch that requires counsel
-- approval) and the business has a complete postal address.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.secrets WHERE name = 'crewflow_unsubscribe_signing_key'
  ) THEN
    PERFORM vault.create_secret(
      pg_catalog.encode(extensions.gen_random_bytes(32), 'hex'),
      'crewflow_unsubscribe_signing_key',
      'HMAC key for CrewFlow marketing unsubscribe links'
    );
  END IF;
END;
$$;

CREATE FUNCTION public.marketing_unsubscribe_signature(target_customer_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    extensions.hmac(
      pg_catalog.convert_to(target_customer_id::text, 'UTF8'),
      pg_catalog.convert_to(secret.decrypted_secret, 'UTF8'),
      'sha256'
    ),
    'hex'
  )
  FROM vault.decrypted_secrets AS secret
  WHERE secret.name = 'crewflow_unsubscribe_signing_key';
$$;

-- Returns the customer id only for an authentic token.
CREATE FUNCTION public.verified_unsubscribe_customer(unsubscribe_token text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  candidate_id uuid;
  expected text;
BEGIN
  IF unsubscribe_token IS NULL
    OR unsubscribe_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{64}$' THEN
    RETURN NULL;
  END IF;
  candidate_id := split_part(unsubscribe_token, '.', 1)::uuid;
  expected := public.marketing_unsubscribe_signature(candidate_id);
  IF expected IS NULL OR expected <> split_part(unsubscribe_token, '.', 2) THEN
    RETURN NULL;
  END IF;
  RETURN candidate_id;
END;
$$;

CREATE FUNCTION public.preview_marketing_unsubscribe(unsubscribe_token text)
RETURNS TABLE (company_name text, already_unsubscribed boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE target_customer_id uuid := public.verified_unsubscribe_customer(unsubscribe_token);
BEGIN
  IF target_customer_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT tenant.display_name, NOT customer.marketing_email_opted_in
  FROM public.customers AS customer
  JOIN public.tenants AS tenant ON tenant.id = customer.tenant_id
  WHERE customer.id = target_customer_id;
END;
$$;

CREATE FUNCTION public.unsubscribe_marketing_email(unsubscribe_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_customer_id uuid := public.verified_unsubscribe_customer(unsubscribe_token);
  customer_tenant_id uuid;
BEGIN
  IF target_customer_id IS NULL THEN RETURN false; END IF;

  UPDATE public.customers
  SET marketing_email_opted_in = false
  WHERE id = target_customer_id AND marketing_email_opted_in
  RETURNING tenant_id INTO customer_tenant_id;

  -- Repeat requests and one-click retries stay idempotent and unaudited.
  IF customer_tenant_id IS NOT NULL THEN
    UPDATE public.follow_up_messages
    SET status = 'cancelled',
        next_attempt_at = NULL,
        last_error_code = 'recipient_unsubscribed'
    WHERE customer_id = target_customer_id
      AND tenant_id = customer_tenant_id
      AND category = 'marketing'
      AND status = 'ready';

    INSERT INTO public.audit_events (
      tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
      customer_tenant_id, NULL, 'customer.marketing_unsubscribed', 'customer',
      target_customer_id, jsonb_build_object('source', 'email_link')
    );
  END IF;

  RETURN EXISTS (SELECT 1 FROM public.customers WHERE id = target_customer_id);
END;
$$;

DROP FUNCTION public.claim_follow_up_email_deliveries(integer);

CREATE FUNCTION public.claim_follow_up_email_deliveries(
  target_batch_size integer DEFAULT 10,
  include_marketing boolean DEFAULT false
)
RETURNS TABLE (
  message_id uuid,
  lease_token uuid,
  to_email text,
  subject text,
  body text,
  sender_name text,
  reply_to_email text,
  category text,
  unsubscribe_token text,
  postal_address text
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

  UPDATE public.follow_up_messages AS message
  SET status = 'failed',
      lease_token = NULL,
      lease_expires_at = NULL,
      next_attempt_at = NULL,
      last_error_code = 'delivery_lease_expired'
  WHERE message.status = 'processing'
    AND message.lease_expires_at < now()
    AND message.attempt_count >= 5;

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

  -- Marketing consent and the paid-invoice premise are rechecked only when
  -- marketing delivery is enabled; otherwise those messages stay held.
  IF include_marketing THEN
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
      AND message.category = 'marketing'
      AND (
        message.status = 'ready'
        OR (message.status = 'processing' AND message.lease_expires_at < now())
      )
      AND (
        customer.archived_at IS NOT NULL
        OR customer.email_suppressed_at IS NOT NULL
        OR lower(customer.email) IS DISTINCT FROM message.to_email
        OR NOT customer.marketing_email_opted_in
        OR invoice.status <> 'paid'
        OR invoice.paid_cents <> invoice.total_cents
      );
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT message.id
    FROM public.follow_up_messages AS message
    JOIN public.tenants AS tenant ON tenant.id = message.tenant_id
    WHERE message.attempt_count < 5
      AND (
        (message.status = 'ready' AND message.next_attempt_at <= now())
        OR (message.status = 'processing' AND message.lease_expires_at < now())
      )
      AND (
        message.category = 'transactional'
        OR (
          include_marketing
          AND message.category = 'marketing'
          AND nullif(btrim(tenant.street_address), '') IS NOT NULL
          AND nullif(btrim(tenant.city), '') IS NOT NULL
          AND nullif(btrim(tenant.state_code), '') IS NOT NULL
          AND nullif(btrim(tenant.postal_code), '') IS NOT NULL
          AND public.marketing_unsubscribe_signature(message.customer_id) IS NOT NULL
        )
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
    RETURNING message.id, message.tenant_id, message.customer_id,
      message.lease_token, message.to_email, message.subject, message.body,
      message.category
  )
  SELECT claimed.id, claimed.lease_token, claimed.to_email, claimed.subject,
    claimed.body, tenant.display_name, tenant.business_email,
    claimed.category::text,
    CASE WHEN claimed.category = 'marketing' THEN
      claimed.customer_id::text || '.'
        || public.marketing_unsubscribe_signature(claimed.customer_id)
    END,
    CASE WHEN claimed.category = 'marketing' THEN
      concat_ws(', ', btrim(tenant.street_address), btrim(tenant.city),
        btrim(tenant.state_code) || ' ' || btrim(tenant.postal_code),
        tenant.country_code)
    END
  FROM claimed
  JOIN public.tenants AS tenant ON tenant.id = claimed.tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.marketing_unsubscribe_signature(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verified_unsubscribe_customer(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preview_marketing_unsubscribe(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_marketing_unsubscribe(text)
  TO anon, authenticated;
REVOKE ALL ON FUNCTION public.unsubscribe_marketing_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unsubscribe_marketing_email(text)
  TO anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_follow_up_email_deliveries(integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_follow_up_email_deliveries(integer, boolean)
  TO service_role;

COMMENT ON FUNCTION public.unsubscribe_marketing_email(text) IS
  'Public, idempotent opt-out from a signed email link. Cancels ready marketing mail for that customer.';
COMMENT ON FUNCTION public.claim_follow_up_email_deliveries(integer, boolean) IS
  'Service-only lease of ready Follow-Up email. Marketing is claimed only when requested and the business has a complete postal address.';
