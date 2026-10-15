-- CrewFlow Phase 3: tenant-safe quotes, immutable line-item snapshots, and
-- high-entropy single-purpose public customer decision links.

CREATE TYPE public.quote_status AS ENUM (
  'draft',
  'sent',
  'accepted',
  'declined',
  'expired',
  'void'
);

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_id_tenant_unique UNIQUE (id, tenant_id);

CREATE TABLE public.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  status public.quote_status NOT NULL DEFAULT 'draft',
  currency_code text NOT NULL DEFAULT 'USD',
  subtotal_cents integer NOT NULL,
  discount_cents integer NOT NULL DEFAULT 0,
  tax_rate_bps integer NOT NULL,
  tax_cents integer NOT NULL,
  total_cents integer NOT NULL,
  expires_at timestamptz NOT NULL,
  decision_token_hash text UNIQUE,
  sent_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quotes_job_tenant_fk FOREIGN KEY (job_id, tenant_id)
    REFERENCES public.jobs(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT quotes_customer_tenant_fk FOREIGN KEY (customer_id, tenant_id)
    REFERENCES public.customers(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT quotes_currency_usd CHECK (currency_code = 'USD'),
  CONSTRAINT quotes_amounts_valid CHECK (
    subtotal_cents >= 0
    AND discount_cents >= 0
    AND discount_cents <= subtotal_cents
    AND tax_rate_bps BETWEEN 0 AND 10000
    AND tax_cents >= 0
    AND total_cents = subtotal_cents - discount_cents + tax_cents
  ),
  CONSTRAINT quotes_token_hash_format CHECK (
    decision_token_hash IS NULL OR decision_token_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT quotes_decision_timestamps CHECK (
    (status <> 'accepted' OR accepted_at IS NOT NULL)
    AND (status <> 'declined' OR declined_at IS NOT NULL)
  )
);

ALTER TABLE public.quotes ADD CONSTRAINT quotes_id_tenant_unique UNIQUE (id, tenant_id);
CREATE UNIQUE INDEX quotes_one_draft_per_job_idx
  ON public.quotes (job_id) WHERE status = 'draft';
CREATE INDEX quotes_tenant_job_created_idx
  ON public.quotes (tenant_id, job_id, created_at DESC);
CREATE INDEX quotes_tenant_status_expiry_idx
  ON public.quotes (tenant_id, status, expires_at);

CREATE TABLE public.quote_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  quote_id uuid NOT NULL,
  position smallint NOT NULL,
  description text NOT NULL,
  quantity integer NOT NULL,
  unit_price_cents integer NOT NULL,
  taxable boolean NOT NULL DEFAULT true,
  line_total_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quote_line_items_quote_tenant_fk FOREIGN KEY (quote_id, tenant_id)
    REFERENCES public.quotes(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT quote_line_items_position_unique UNIQUE (quote_id, position),
  CONSTRAINT quote_line_items_position_valid CHECK (position BETWEEN 1 AND 50),
  CONSTRAINT quote_line_items_description_length CHECK (char_length(description) BETWEEN 1 AND 240),
  CONSTRAINT quote_line_items_quantity_valid CHECK (quantity BETWEEN 1 AND 999),
  CONSTRAINT quote_line_items_price_valid CHECK (unit_price_cents BETWEEN 0 AND 100000000),
  CONSTRAINT quote_line_items_total_valid CHECK (line_total_cents = quantity * unit_price_cents)
);

CREATE INDEX quote_line_items_quote_idx ON public.quote_line_items (quote_id, position);

CREATE TRIGGER quotes_updated_at
BEFORE UPDATE ON public.quotes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER quotes_tenant_immutable
BEFORE UPDATE ON public.quotes
FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_change();

ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY quotes_read_office ON public.quotes
FOR SELECT TO authenticated USING (
  public.current_user_has_tenant_role(
    tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  )
);

CREATE POLICY quote_line_items_read_office ON public.quote_line_items
FOR SELECT TO authenticated USING (
  public.current_user_has_tenant_role(
    tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  )
);

REVOKE ALL ON public.quotes, public.quote_line_items FROM anon, authenticated;
GRANT SELECT ON public.quotes, public.quote_line_items TO authenticated;

CREATE FUNCTION public.save_job_quote(
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
  line_total integer;
  quote_customer_id uuid;
  quote_subtotal integer := 0;
  quote_tax_cents integer;
  quote_tax_rate_bps integer;
  quote_taxable_discount integer;
  quote_taxable_subtotal integer := 0;
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

    line_total := item_quantity * item_unit_price_cents;
    quote_subtotal := quote_subtotal + line_total;
    IF item_taxable THEN
      quote_taxable_subtotal := quote_taxable_subtotal + line_total;
    END IF;
  END LOOP;

  IF quote_discount_cents > quote_subtotal THEN
    RAISE EXCEPTION 'quote discount cannot exceed subtotal' USING ERRCODE = '22023';
  END IF;

  quote_taxable_discount := CASE
    WHEN quote_subtotal = 0 THEN 0
    ELSE round(
      quote_discount_cents::numeric * quote_taxable_subtotal::numeric / quote_subtotal::numeric
    )::integer
  END;
  quote_tax_cents := round(
    greatest(quote_taxable_subtotal - quote_taxable_discount, 0)::numeric
      * quote_tax_rate_bps::numeric / 10000
  )::integer;

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
      quote_subtotal - quote_discount_cents + quote_tax_cents,
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
        total_cents = quote_subtotal - quote_discount_cents + quote_tax_cents,
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
      item_quantity * item_unit_price_cents
    );
  END LOOP;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    quote_tenant_id, auth.uid(), 'quote.saved', 'quote', draft_quote_id,
    jsonb_build_object('job_id', target_job_id, 'total_cents', quote_subtotal - quote_discount_cents + quote_tax_cents)
  );

  RETURN draft_quote_id;
END;
$$;

CREATE FUNCTION public.publish_job_quote(target_quote_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  generated_token text;
  quote_job_id uuid;
  quote_tenant_id uuid;
BEGIN
  SELECT quote.tenant_id, quote.job_id
  INTO quote_tenant_id, quote_job_id
  FROM public.quotes AS quote
  WHERE quote.id = target_quote_id
    AND quote.status = 'draft'
    AND quote.expires_at > now()
  FOR UPDATE;

  IF quote_tenant_id IS NULL OR NOT public.current_user_has_tenant_role(
    quote_tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'draft quote is unavailable' USING ERRCODE = '42501';
  END IF;

  generated_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  UPDATE public.quotes
  SET status = 'void'
  WHERE job_id = quote_job_id
    AND tenant_id = quote_tenant_id
    AND status = 'sent';

  UPDATE public.quotes
  SET status = 'sent',
      sent_at = now(),
      decision_token_hash = pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(generated_token, 'UTF8'), 'sha256'),
        'hex'
      )
  WHERE id = target_quote_id;

  UPDATE public.jobs
  SET status = 'quoted'
  WHERE id = quote_job_id AND tenant_id = quote_tenant_id AND status = 'new';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.jobs
    WHERE id = quote_job_id AND tenant_id = quote_tenant_id AND status = 'quoted'
  ) THEN
    RAISE EXCEPTION 'job is no longer available for quoting' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    quote_tenant_id, auth.uid(), 'quote.sent', 'quote', target_quote_id,
    jsonb_build_object('job_id', quote_job_id)
  );

  RETURN generated_token;
END;
$$;

CREATE FUNCTION public.get_public_quote(quote_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'quote_id', quote.id,
    'company_name', tenant.display_name,
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

CREATE FUNCTION public.decide_public_quote(quote_token text, quote_decision text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  quote_id_value uuid;
  quote_job_id uuid;
  quote_tenant_id uuid;
BEGIN
  IF quote_token IS NULL
    OR quote_decision IS NULL
    OR quote_token !~ '^[0-9a-f]{64}$'
    OR quote_decision NOT IN ('accepted', 'declined')
  THEN
    RAISE EXCEPTION 'quote decision is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT quote.id, quote.tenant_id, quote.job_id
  INTO quote_id_value, quote_tenant_id, quote_job_id
  FROM public.quotes AS quote
  WHERE quote.decision_token_hash = pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(quote_token, 'UTF8'), 'sha256'),
      'hex'
    )
    AND quote.status = 'sent'
  FOR UPDATE;

  IF quote_id_value IS NULL THEN
    RAISE EXCEPTION 'quote is unavailable or already decided' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM public.quotes WHERE id = quote_id_value AND expires_at <= now()) THEN
    UPDATE public.quotes SET status = 'expired' WHERE id = quote_id_value;
    RAISE EXCEPTION 'quote has expired' USING ERRCODE = '22023';
  END IF;

  IF quote_decision = 'accepted' THEN
    UPDATE public.jobs
    SET status = 'accepted'
    WHERE id = quote_job_id AND tenant_id = quote_tenant_id AND status = 'quoted';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'job is no longer available for acceptance' USING ERRCODE = '22023';
    END IF;

    UPDATE public.quotes
    SET status = 'accepted', accepted_at = now()
    WHERE id = quote_id_value;
  ELSE
    UPDATE public.quotes
    SET status = 'declined', declined_at = now()
    WHERE id = quote_id_value;
  END IF;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    quote_tenant_id, NULL, 'quote.' || quote_decision, 'quote', quote_id_value,
    jsonb_build_object('job_id', quote_job_id, 'customer_token_action', true)
  );

  RETURN quote_decision;
END;
$$;

REVOKE ALL ON FUNCTION public.save_job_quote(uuid, jsonb, integer, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_job_quote(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_quote(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decide_public_quote(text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.save_job_quote(uuid, jsonb, integer, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_job_quote(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_quote(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_public_quote(text, text) TO anon, authenticated;

COMMENT ON TABLE public.quotes IS
  'Tenant quote snapshots with token-hashed public acceptance state; raw tokens are never stored.';
COMMENT ON TABLE public.quote_line_items IS
  'Immutable-at-send billable item snapshots owned by a quote and tenant.';
