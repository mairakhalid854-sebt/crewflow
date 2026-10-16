-- Add the tenant time zone to the token-scoped public invoice projection so
-- browser and PDF due dates render in the business's configured local zone.

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
