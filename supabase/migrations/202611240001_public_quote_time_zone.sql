-- The public quote page formatted expires_at in the server's time zone (UTC),
-- so a quote that expires at 11:59 PM company time showed the next day.
-- Return the company time zone, as get_public_invoice already does.
-- CREATE OR REPLACE keeps the existing grants.

CREATE OR REPLACE FUNCTION public.get_public_quote(quote_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'quote_id', quote.id,
    'company_name', tenant.display_name,
    'company_time_zone', tenant.time_zone,
    'customer_name', trim(customer.first_name || ' ' || customer.last_name),
    'job_title', job.title,
    'status', CASE
      WHEN quote.status = 'sent' AND quote.expires_at <= now() THEN 'expired'
      ELSE quote.status::text
    END,
    'currency_code', quote.currency_code,
    'subtotal_cents', quote.subtotal_cents,
    'discount_cents', quote.discount_cents,
    'tax_rate_bps', quote.tax_rate_bps,
    'tax_cents', quote.tax_cents,
    'total_cents', quote.total_cents,
    'expires_at', quote.expires_at,
    'sent_at', quote.sent_at,
    'accepted_at', quote.accepted_at,
    'declined_at', quote.declined_at,
    'items', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'description', item.description,
        'quantity', item.quantity,
        'unit_price_cents', item.unit_price_cents,
        'taxable', item.taxable,
        'line_total_cents', item.line_total_cents
      ) ORDER BY item.position), '[]'::jsonb)
      FROM public.quote_line_items AS item
      WHERE item.quote_id = quote.id
    )
  )
  FROM public.quotes AS quote
  JOIN public.tenants AS tenant ON tenant.id = quote.tenant_id
  JOIN public.customers AS customer
    ON customer.id = quote.customer_id AND customer.tenant_id = quote.tenant_id
  JOIN public.jobs AS job
    ON job.id = quote.job_id AND job.tenant_id = quote.tenant_id
  WHERE quote_token ~ '^[0-9a-f]{64}$'
    AND quote.decision_token_hash = pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(quote_token, 'UTF8'), 'sha256'),
      'hex'
    )
    AND quote.status IN ('sent', 'accepted', 'declined', 'expired');
$$;
