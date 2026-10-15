-- Quote totals can legitimately exceed a 32-bit integer when the maximum
-- quantity and unit price are combined. Keep cents exact with 64-bit values.

ALTER TABLE public.quote_line_items
  DROP CONSTRAINT quote_line_items_total_valid;

ALTER TABLE public.quotes
  DROP CONSTRAINT quotes_amounts_valid;

ALTER TABLE public.quote_line_items
  ALTER COLUMN line_total_cents TYPE bigint;

ALTER TABLE public.quotes
  ALTER COLUMN subtotal_cents TYPE bigint,
  ALTER COLUMN discount_cents TYPE bigint,
  ALTER COLUMN tax_cents TYPE bigint,
  ALTER COLUMN total_cents TYPE bigint;

ALTER TABLE public.quote_line_items
  ADD CONSTRAINT quote_line_items_total_valid CHECK (
    line_total_cents = quantity::bigint * unit_price_cents::bigint
  );

ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_amounts_valid CHECK (
    subtotal_cents >= 0
    AND discount_cents >= 0
    AND discount_cents <= subtotal_cents
    AND tax_rate_bps BETWEEN 0 AND 10000
    AND tax_cents >= 0
    AND total_cents = subtotal_cents - discount_cents + tax_cents
  );

CREATE OR REPLACE FUNCTION public.save_job_quote(
  target_job_id uuid,
  quote_items jsonb,
  quote_discount_cents integer,
  quote_expires_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  draft_quote_id uuid;
  item jsonb;
  item_description text;
  item_quantity integer;
  item_taxable boolean;
  item_unit_price_cents integer;
  line_total bigint;
  quote_customer_id uuid;
  quote_subtotal bigint := 0;
  quote_tax_cents bigint;
  quote_tax_rate_bps integer;
  quote_taxable_discount bigint;
  quote_taxable_subtotal bigint := 0;
  quote_tenant_id uuid;
  row_position integer := 0;
BEGIN
  IF jsonb_typeof(quote_items) <> 'array'
    OR jsonb_array_length(quote_items) NOT BETWEEN 1 AND 50
  THEN
    RAISE EXCEPTION 'quote must include between 1 and 50 line items' USING ERRCODE = '22023';
  END IF;

  IF quote_discount_cents IS NULL OR quote_discount_cents < 0 THEN
    RAISE EXCEPTION 'quote discount must be zero or greater' USING ERRCODE = '22023';
  END IF;

  IF quote_expires_at IS NULL
    OR quote_expires_at <= now()
    OR quote_expires_at > now() + interval '180 days'
  THEN
    RAISE EXCEPTION 'quote expiration must be within the next 180 days' USING ERRCODE = '22023';
  END IF;

  SELECT job.tenant_id, job.customer_id, tenant.tax_rate_bps
  INTO quote_tenant_id, quote_customer_id, quote_tax_rate_bps
  FROM public.jobs AS job
  JOIN public.tenants AS tenant ON tenant.id = job.tenant_id
  WHERE job.id = target_job_id
    AND job.archived_at IS NULL
    AND job.status IN ('new', 'quoted')
  FOR UPDATE OF job;

  IF quote_tenant_id IS NULL OR NOT public.current_user_has_tenant_role(
    quote_tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'job is unavailable for quoting' USING ERRCODE = '42501';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(quote_items)
  LOOP
    row_position := row_position + 1;
    item_description := trim(item->>'description');

    BEGIN
      item_quantity := (item->>'quantity')::integer;
      item_unit_price_cents := (item->>'unit_price_cents')::integer;
      item_taxable := coalesce((item->>'taxable')::boolean, true);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'quote line item values are invalid' USING ERRCODE = '22023';
    END;

    IF item_description IS NULL OR char_length(item_description) NOT BETWEEN 1 AND 240
      OR item_quantity IS NULL OR item_quantity NOT BETWEEN 1 AND 999
      OR item_unit_price_cents IS NULL OR item_unit_price_cents NOT BETWEEN 0 AND 100000000
    THEN
      RAISE EXCEPTION 'quote line item values are invalid' USING ERRCODE = '22023';
    END IF;

    line_total := item_quantity::bigint * item_unit_price_cents::bigint;
    quote_subtotal := quote_subtotal + line_total;
    IF item_taxable THEN
      quote_taxable_subtotal := quote_taxable_subtotal + line_total;
    END IF;
  END LOOP;

  IF quote_discount_cents::bigint > quote_subtotal THEN
    RAISE EXCEPTION 'quote discount cannot exceed subtotal' USING ERRCODE = '22023';
  END IF;

  quote_taxable_discount := CASE
    WHEN quote_subtotal = 0 THEN 0
    ELSE round(
      quote_discount_cents::numeric * quote_taxable_subtotal::numeric / quote_subtotal::numeric
    )::bigint
  END;
  quote_tax_cents := round(
    greatest(quote_taxable_subtotal - quote_taxable_discount, 0::bigint)::numeric
      * quote_tax_rate_bps::numeric / 10000
  )::bigint;

  SELECT quote.id
  INTO draft_quote_id
  FROM public.quotes AS quote
  WHERE quote.job_id = target_job_id AND quote.status = 'draft'
  FOR UPDATE;

  IF draft_quote_id IS NULL THEN
    INSERT INTO public.quotes (
      tenant_id, job_id, customer_id, subtotal_cents, discount_cents,
      tax_rate_bps, tax_cents, total_cents, expires_at, created_by_user_id
    ) VALUES (
      quote_tenant_id, target_job_id, quote_customer_id, quote_subtotal,
      quote_discount_cents, quote_tax_rate_bps, quote_tax_cents,
      quote_subtotal - quote_discount_cents::bigint + quote_tax_cents,
      quote_expires_at, auth.uid()
    )
    RETURNING id INTO draft_quote_id;
  ELSE
    UPDATE public.quotes
    SET customer_id = quote_customer_id,
        subtotal_cents = quote_subtotal,
        discount_cents = quote_discount_cents,
        tax_rate_bps = quote_tax_rate_bps,
        tax_cents = quote_tax_cents,
        total_cents = quote_subtotal - quote_discount_cents::bigint + quote_tax_cents,
        expires_at = quote_expires_at
    WHERE id = draft_quote_id;
    DELETE FROM public.quote_line_items WHERE quote_id = draft_quote_id;
  END IF;

  row_position := 0;
  FOR item IN SELECT value FROM jsonb_array_elements(quote_items)
  LOOP
    row_position := row_position + 1;
    item_description := trim(item->>'description');
    item_quantity := (item->>'quantity')::integer;
    item_unit_price_cents := (item->>'unit_price_cents')::integer;
    item_taxable := coalesce((item->>'taxable')::boolean, true);

    INSERT INTO public.quote_line_items (
      tenant_id, quote_id, position, description, quantity,
      unit_price_cents, taxable, line_total_cents
    ) VALUES (
      quote_tenant_id, draft_quote_id, row_position, item_description,
      item_quantity, item_unit_price_cents, item_taxable,
      item_quantity::bigint * item_unit_price_cents::bigint
    );
  END LOOP;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    quote_tenant_id, auth.uid(), 'quote.saved', 'quote', draft_quote_id,
    jsonb_build_object(
      'job_id', target_job_id,
      'total_cents', quote_subtotal - quote_discount_cents::bigint + quote_tax_cents
    )
  );

  RETURN draft_quote_id;
END;
$$;
