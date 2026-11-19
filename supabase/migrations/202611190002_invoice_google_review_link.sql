-- CrewFlow360: Google review link on invoices.
--
-- The owner saves the business's Google review link once in Company
-- settings. Every invoice PDF and the customer's invoice page then show a
-- "Leave us a Google review" link. Only Google-owned HTTPS hosts are
-- accepted so an invoice can never carry an arbitrary link. Empty means off.

ALTER TABLE public.tenant_settings
  ADD COLUMN google_review_url text,
  ADD CONSTRAINT tenant_settings_google_review_url_google CHECK (
    google_review_url IS NULL
    OR (
      char_length(google_review_url) <= 500
      AND google_review_url ~ '^https://((www|search|maps|business)\.google\.com|g\.page|maps\.app\.goo\.gl|goo\.gl|g\.co)/[^[:space:]]*$'
    )
  );

COMMENT ON COLUMN public.tenant_settings.google_review_url IS
  'Google review link printed on invoices. NULL hides the review prompt.';

-- Keep link changes visible in the audit trail.
CREATE FUNCTION public.audit_google_review_url_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.google_review_url IS DISTINCT FROM OLD.google_review_url THEN
    INSERT INTO public.audit_events (
      tenant_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
      NEW.tenant_id,
      auth.uid(),
      CASE
        WHEN NEW.google_review_url IS NULL THEN 'settings.google_review_link_removed'
        ELSE 'settings.google_review_link_saved'
      END,
      'tenant_settings',
      NEW.id,
      jsonb_build_object('google_review_url', NEW.google_review_url)
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_google_review_url_change() FROM PUBLIC;

CREATE TRIGGER tenant_settings_audit_google_review_url
AFTER UPDATE OF google_review_url ON public.tenant_settings
FOR EACH ROW EXECUTE FUNCTION public.audit_google_review_url_change();

-- Add the review link to the token-scoped public invoice projection. Void
-- invoices never ask for a review.
CREATE OR REPLACE FUNCTION public.get_public_invoice(invoice_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'invoice_id', invoice.id,
    'invoice_number', invoice.invoice_number,
    'company_name', tenant.display_name,
    'company_time_zone', tenant.time_zone,
    'customer_name', trim(customer.first_name || ' ' || customer.last_name),
    'job_title', job.title,
    'status', invoice.status,
    'currency_code', invoice.currency_code,
    'subtotal_cents', invoice.subtotal_cents,
    'discount_cents', invoice.discount_cents,
    'tax_cents', invoice.tax_cents,
    'total_cents', invoice.total_cents,
    'paid_cents', invoice.paid_cents,
    'outstanding_cents', invoice.total_cents - invoice.paid_cents,
    'due_at', invoice.due_at,
    'payment_url', invoice.payment_url,
    'sent_at', invoice.sent_at,
    'void_reason', CASE WHEN invoice.status = 'void' THEN invoice.void_reason ELSE NULL END,
    'google_review_url', CASE WHEN invoice.status = 'void' THEN NULL ELSE settings.google_review_url END,
    'items', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'description', item.description,
        'quantity', item.quantity,
        'unit_price_cents', item.unit_price_cents,
        'taxable', item.taxable,
        'line_total_cents', item.line_total_cents
      ) ORDER BY item.position), '[]'::jsonb)
      FROM public.invoice_line_items AS item
      WHERE item.invoice_id = invoice.id
    )
  )
  FROM public.invoices AS invoice
  JOIN public.tenants AS tenant ON tenant.id = invoice.tenant_id
  LEFT JOIN public.tenant_settings AS settings ON settings.tenant_id = invoice.tenant_id
  JOIN public.customers AS customer
    ON customer.id = invoice.customer_id AND customer.tenant_id = invoice.tenant_id
  JOIN public.jobs AS job
    ON job.id = invoice.job_id AND job.tenant_id = invoice.tenant_id
  WHERE invoice_token ~ '^[0-9a-f]{64}$'
    AND invoice.public_token_hash = pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(invoice_token, 'UTF8'), 'sha256'),
      'hex'
    )
    AND invoice.status IN ('sent', 'partially_paid', 'paid', 'void');
$$;

REVOKE ALL ON FUNCTION public.get_public_invoice(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_invoice(text) TO anon, authenticated;
