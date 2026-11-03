-- CrewFlow Phase 3: immutable invoice snapshots, business-owned external
-- payment links, and an append-only manual payment ledger.

CREATE TYPE public.invoice_status AS ENUM (
  'draft',
  'sent',
  'partially_paid',
  'paid',
  'void'
);

CREATE TYPE public.payment_record_type AS ENUM ('payment', 'adjustment');
CREATE TYPE public.payment_method AS ENUM (
  'cash',
  'check',
  'external_transfer',
  'other'
);
CREATE TYPE public.payment_source AS ENUM ('manual', 'provider_confirmed');

CREATE TABLE public.invoice_number_counters (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE RESTRICT,
  next_number bigint NOT NULL DEFAULT 1,
  CONSTRAINT invoice_number_counters_positive CHECK (next_number > 0)
);

CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  invoice_number bigint NOT NULL,
  status public.invoice_status NOT NULL DEFAULT 'draft',
  currency_code text NOT NULL DEFAULT 'USD',
  subtotal_cents bigint NOT NULL,
  discount_cents bigint NOT NULL DEFAULT 0,
  tax_rate_bps integer NOT NULL,
  tax_cents bigint NOT NULL,
  total_cents bigint NOT NULL,
  paid_cents bigint NOT NULL DEFAULT 0,
  due_at timestamptz NOT NULL,
  payment_url text,
  public_token_hash text UNIQUE,
  sent_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT invoices_number_tenant_unique UNIQUE (tenant_id, invoice_number),
  CONSTRAINT invoices_job_tenant_fk FOREIGN KEY (job_id, tenant_id)
    REFERENCES public.jobs(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT invoices_customer_tenant_fk FOREIGN KEY (customer_id, tenant_id)
    REFERENCES public.customers(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT invoices_currency_usd CHECK (currency_code = 'USD'),
  CONSTRAINT invoices_amounts_valid CHECK (
    subtotal_cents >= 0
    AND discount_cents >= 0
    AND discount_cents <= subtotal_cents
    AND tax_rate_bps BETWEEN 0 AND 10000
    AND tax_cents >= 0
    AND total_cents = subtotal_cents - discount_cents + tax_cents
    AND paid_cents BETWEEN 0 AND total_cents
  ),
  CONSTRAINT invoices_payment_url_length CHECK (
    payment_url IS NULL OR char_length(payment_url) <= 2048
  ),
  CONSTRAINT invoices_token_hash_format CHECK (
    public_token_hash IS NULL OR public_token_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT invoices_void_reason_required CHECK (
    status <> 'void'
    OR (voided_at IS NOT NULL AND char_length(trim(void_reason)) BETWEEN 3 AND 500)
  )
);

CREATE UNIQUE INDEX invoices_one_active_per_job_idx
  ON public.invoices (job_id) WHERE status <> 'void';
CREATE INDEX invoices_tenant_status_due_idx
  ON public.invoices (tenant_id, status, due_at);
CREATE INDEX invoices_customer_created_idx
  ON public.invoices (tenant_id, customer_id, created_at DESC);

CREATE TABLE public.invoice_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL,
  position smallint NOT NULL,
  description text NOT NULL,
  quantity integer NOT NULL,
  unit_price_cents integer NOT NULL,
  taxable boolean NOT NULL DEFAULT true,
  line_total_cents bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_line_items_invoice_tenant_fk
    FOREIGN KEY (invoice_id, tenant_id)
    REFERENCES public.invoices(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT invoice_line_items_position_unique UNIQUE (invoice_id, position),
  CONSTRAINT invoice_line_items_position_valid CHECK (position BETWEEN 1 AND 50),
  CONSTRAINT invoice_line_items_description_length CHECK (
    char_length(description) BETWEEN 1 AND 240
  ),
  CONSTRAINT invoice_line_items_quantity_valid CHECK (quantity BETWEEN 1 AND 999),
  CONSTRAINT invoice_line_items_price_valid CHECK (
    unit_price_cents BETWEEN 0 AND 100000000
  ),
  CONSTRAINT invoice_line_items_total_valid CHECK (
    line_total_cents = quantity::bigint * unit_price_cents::bigint
  )
);

CREATE INDEX invoice_line_items_invoice_idx
  ON public.invoice_line_items (invoice_id, position);

CREATE TABLE public.payment_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL,
  record_type public.payment_record_type NOT NULL,
  amount_cents bigint NOT NULL,
  method public.payment_method NOT NULL,
  source public.payment_source NOT NULL DEFAULT 'manual',
  reference text,
  note text,
  received_at timestamptz NOT NULL,
  recorded_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_records_invoice_tenant_fk
    FOREIGN KEY (invoice_id, tenant_id)
    REFERENCES public.invoices(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT payment_records_amount_nonzero CHECK (amount_cents <> 0),
  CONSTRAINT payment_records_payment_positive CHECK (
    record_type <> 'payment' OR amount_cents > 0
  ),
  CONSTRAINT payment_records_reference_length CHECK (
    reference IS NULL OR char_length(reference) <= 160
  ),
  CONSTRAINT payment_records_note_length CHECK (
    note IS NULL OR char_length(note) <= 500
  )
);

CREATE INDEX payment_records_invoice_received_idx
  ON public.payment_records (invoice_id, received_at DESC);
CREATE INDEX payment_records_tenant_received_idx
  ON public.payment_records (tenant_id, received_at DESC);

CREATE TRIGGER invoices_updated_at
BEFORE UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER invoices_tenant_immutable
BEFORE UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_change();

ALTER TABLE public.invoice_number_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY invoices_read_office ON public.invoices
FOR SELECT TO authenticated USING (
  public.current_user_has_tenant_role(
    tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  )
);

CREATE POLICY invoice_line_items_read_office ON public.invoice_line_items
FOR SELECT TO authenticated USING (
  public.current_user_has_tenant_role(
    tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  )
);

CREATE POLICY payment_records_read_office ON public.payment_records
FOR SELECT TO authenticated USING (
  public.current_user_has_tenant_role(
    tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  )
);

REVOKE ALL ON public.invoice_number_counters, public.invoices,
  public.invoice_line_items, public.payment_records FROM anon, authenticated;
GRANT SELECT ON public.invoices, public.invoice_line_items,
  public.payment_records TO authenticated;

CREATE FUNCTION public.is_allowed_external_payment_url(candidate text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT candidate IS NULL OR (
    char_length(candidate) BETWEEN 12 AND 2048
    AND candidate ~ '^https://([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::[0-9]{1,5})?(?:[/?#].*)?$'
    AND candidate !~ '[[:space:]]'
  );
$$;

REVOKE ALL ON FUNCTION public.is_allowed_external_payment_url(text) FROM PUBLIC;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_payment_url_allowed CHECK (
    public.is_allowed_external_payment_url(payment_url)
  );

CREATE FUNCTION public.save_job_invoice(
  target_job_id uuid,
  invoice_items jsonb,
  invoice_discount_cents bigint,
  invoice_due_at timestamptz,
  invoice_payment_url text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  draft_invoice_id uuid;
  generated_invoice_number bigint;
  item jsonb;
  item_description text;
  item_quantity integer;
  item_taxable boolean;
  item_unit_price_cents integer;
  line_total bigint;
  invoice_customer_id uuid;
  invoice_subtotal bigint := 0;
  invoice_tax_cents bigint;
  invoice_tax_rate_bps integer;
  invoice_taxable_discount bigint;
  invoice_taxable_subtotal bigint := 0;
  invoice_tenant_id uuid;
  normalized_payment_url text := nullif(trim(invoice_payment_url), '');
  row_position integer := 0;
BEGIN
  IF jsonb_typeof(invoice_items) <> 'array'
    OR jsonb_array_length(invoice_items) NOT BETWEEN 1 AND 50
  THEN
    RAISE EXCEPTION 'invoice must include between 1 and 50 line items' USING ERRCODE = '22023';
  END IF;

  IF invoice_discount_cents IS NULL OR invoice_discount_cents < 0 THEN
    RAISE EXCEPTION 'invoice discount must be zero or greater' USING ERRCODE = '22023';
  END IF;

  IF invoice_due_at IS NULL
    OR invoice_due_at <= now()
    OR invoice_due_at > now() + interval '365 days'
  THEN
    RAISE EXCEPTION 'invoice due date must be within the next 365 days' USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_allowed_external_payment_url(normalized_payment_url) THEN
    RAISE EXCEPTION 'external payment URL must use HTTPS and a public hostname' USING ERRCODE = '22023';
  END IF;

  SELECT job.tenant_id, job.customer_id, tenant.tax_rate_bps
  INTO invoice_tenant_id, invoice_customer_id, invoice_tax_rate_bps
  FROM public.jobs AS job
  JOIN public.tenants AS tenant ON tenant.id = job.tenant_id
  WHERE job.id = target_job_id
    AND job.archived_at IS NULL
    AND job.status IN ('completed', 'closed')
  FOR UPDATE OF job;

  IF invoice_tenant_id IS NULL OR NOT public.current_user_has_tenant_role(
    invoice_tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'completed job is unavailable for invoicing' USING ERRCODE = '42501';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(invoice_items)
  LOOP
    row_position := row_position + 1;
    item_description := trim(item->>'description');
    BEGIN
      item_quantity := (item->>'quantity')::integer;
      item_unit_price_cents := (item->>'unit_price_cents')::integer;
      item_taxable := coalesce((item->>'taxable')::boolean, true);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invoice line item values are invalid' USING ERRCODE = '22023';
    END;

    IF item_description IS NULL OR char_length(item_description) NOT BETWEEN 1 AND 240
      OR item_quantity IS NULL OR item_quantity NOT BETWEEN 1 AND 999
      OR item_unit_price_cents IS NULL OR item_unit_price_cents NOT BETWEEN 0 AND 100000000
    THEN
      RAISE EXCEPTION 'invoice line item values are invalid' USING ERRCODE = '22023';
    END IF;

    line_total := item_quantity::bigint * item_unit_price_cents::bigint;
    invoice_subtotal := invoice_subtotal + line_total;
    IF item_taxable THEN
      invoice_taxable_subtotal := invoice_taxable_subtotal + line_total;
    END IF;
  END LOOP;

  IF invoice_discount_cents > invoice_subtotal THEN
    RAISE EXCEPTION 'invoice discount cannot exceed subtotal' USING ERRCODE = '22023';
  END IF;

  invoice_taxable_discount := CASE
    WHEN invoice_subtotal = 0 THEN 0
    ELSE round(
      invoice_discount_cents::numeric * invoice_taxable_subtotal::numeric
        / invoice_subtotal::numeric
    )::bigint
  END;
  invoice_tax_cents := round(
    greatest(invoice_taxable_subtotal - invoice_taxable_discount, 0::bigint)::numeric
      * invoice_tax_rate_bps::numeric / 10000
  )::bigint;

  SELECT invoice.id
  INTO draft_invoice_id
  FROM public.invoices AS invoice
  WHERE invoice.job_id = target_job_id AND invoice.status = 'draft'
  FOR UPDATE;

  IF draft_invoice_id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.invoices
      WHERE job_id = target_job_id AND status <> 'void'
    ) THEN
      RAISE EXCEPTION 'job already has an active invoice' USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.invoice_number_counters (tenant_id, next_number)
    VALUES (invoice_tenant_id, 2)
    ON CONFLICT (tenant_id) DO UPDATE
      SET next_number = public.invoice_number_counters.next_number + 1
    RETURNING next_number - 1 INTO generated_invoice_number;

    INSERT INTO public.invoices (
      tenant_id, job_id, customer_id, invoice_number, subtotal_cents,
      discount_cents, tax_rate_bps, tax_cents, total_cents, due_at,
      payment_url, created_by_user_id
    ) VALUES (
      invoice_tenant_id, target_job_id, invoice_customer_id,
      generated_invoice_number, invoice_subtotal, invoice_discount_cents,
      invoice_tax_rate_bps, invoice_tax_cents,
      invoice_subtotal - invoice_discount_cents + invoice_tax_cents,
      invoice_due_at, normalized_payment_url, auth.uid()
    )
    RETURNING id INTO draft_invoice_id;
  ELSE
    UPDATE public.invoices
    SET customer_id = invoice_customer_id,
        subtotal_cents = invoice_subtotal,
        discount_cents = invoice_discount_cents,
        tax_rate_bps = invoice_tax_rate_bps,
        tax_cents = invoice_tax_cents,
        total_cents = invoice_subtotal - invoice_discount_cents + invoice_tax_cents,
        due_at = invoice_due_at,
        payment_url = normalized_payment_url
    WHERE id = draft_invoice_id;
    DELETE FROM public.invoice_line_items WHERE invoice_id = draft_invoice_id;
  END IF;

  row_position := 0;
  FOR item IN SELECT value FROM jsonb_array_elements(invoice_items)
  LOOP
    row_position := row_position + 1;
    INSERT INTO public.invoice_line_items (
      tenant_id, invoice_id, position, description, quantity,
      unit_price_cents, taxable, line_total_cents
    ) VALUES (
      invoice_tenant_id, draft_invoice_id, row_position, trim(item->>'description'),
      (item->>'quantity')::integer, (item->>'unit_price_cents')::integer,
      coalesce((item->>'taxable')::boolean, true),
      (item->>'quantity')::bigint * (item->>'unit_price_cents')::bigint
    );
  END LOOP;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    invoice_tenant_id, auth.uid(), 'invoice.saved', 'invoice', draft_invoice_id,
    jsonb_build_object('job_id', target_job_id)
  );

  RETURN draft_invoice_id;
END;
$$;

CREATE FUNCTION public.publish_job_invoice(target_invoice_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  generated_token text;
  invoice_tenant_id uuid;
BEGIN
  SELECT invoice.tenant_id
  INTO invoice_tenant_id
  FROM public.invoices AS invoice
  WHERE invoice.id = target_invoice_id AND invoice.status = 'draft'
  FOR UPDATE;

  IF invoice_tenant_id IS NULL OR NOT public.current_user_has_tenant_role(
    invoice_tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'draft invoice is unavailable' USING ERRCODE = '42501';
  END IF;

  generated_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  UPDATE public.invoices
  SET status = 'sent',
      sent_at = now(),
      public_token_hash = pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(generated_token, 'UTF8'), 'sha256'),
        'hex'
      )
  WHERE id = target_invoice_id;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    invoice_tenant_id, auth.uid(), 'invoice.sent', 'invoice', target_invoice_id,
    '{}'::jsonb
  );

  RETURN generated_token;
END;
$$;

CREATE FUNCTION public.get_public_invoice(invoice_token text)
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

CREATE FUNCTION public.record_manual_invoice_payment(
  target_invoice_id uuid,
  payment_amount_cents bigint,
  payment_method public.payment_method,
  payment_reference text,
  payment_note text,
  payment_received_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  invoice_paid bigint;
  invoice_tenant_id uuid;
  invoice_total bigint;
  payment_id uuid;
BEGIN
  SELECT invoice.tenant_id, invoice.total_cents, invoice.paid_cents
  INTO invoice_tenant_id, invoice_total, invoice_paid
  FROM public.invoices AS invoice
  WHERE invoice.id = target_invoice_id
    AND invoice.status IN ('sent', 'partially_paid')
  FOR UPDATE;

  IF invoice_tenant_id IS NULL OR NOT public.current_user_has_tenant_role(
    invoice_tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'invoice is unavailable for payment recording' USING ERRCODE = '42501';
  END IF;

  IF payment_amount_cents IS NULL OR payment_amount_cents <= 0
    OR invoice_paid + payment_amount_cents > invoice_total
  THEN
    RAISE EXCEPTION 'payment amount exceeds the outstanding invoice balance' USING ERRCODE = '22023';
  END IF;

  IF payment_received_at IS NULL OR payment_received_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'payment received time is invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payment_records (
    tenant_id, invoice_id, record_type, amount_cents, method, source,
    reference, note, received_at, recorded_by_user_id
  ) VALUES (
    invoice_tenant_id, target_invoice_id, 'payment', payment_amount_cents,
    payment_method, 'manual', nullif(trim(payment_reference), ''),
    nullif(trim(payment_note), ''), payment_received_at, auth.uid()
  )
  RETURNING id INTO payment_id;

  UPDATE public.invoices
  SET paid_cents = invoice_paid + payment_amount_cents,
      status = CASE
        WHEN invoice_paid + payment_amount_cents = invoice_total THEN 'paid'::public.invoice_status
        ELSE 'partially_paid'::public.invoice_status
      END
  WHERE id = target_invoice_id;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    invoice_tenant_id, auth.uid(), 'invoice.payment_recorded', 'invoice',
    target_invoice_id, jsonb_build_object(
      'payment_record_id', payment_id,
      'amount_cents', payment_amount_cents,
      'source', 'manual'
    )
  );

  RETURN payment_id;
END;
$$;

CREATE FUNCTION public.record_invoice_adjustment(
  target_invoice_id uuid,
  adjustment_amount_cents bigint,
  adjustment_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  adjustment_id uuid;
  invoice_paid bigint;
  invoice_tenant_id uuid;
  invoice_total bigint;
  new_paid bigint;
BEGIN
  SELECT invoice.tenant_id, invoice.total_cents, invoice.paid_cents
  INTO invoice_tenant_id, invoice_total, invoice_paid
  FROM public.invoices AS invoice
  WHERE invoice.id = target_invoice_id
    AND invoice.status IN ('sent', 'partially_paid', 'paid')
  FOR UPDATE;

  IF invoice_tenant_id IS NULL OR NOT public.current_user_has_tenant_role(
    invoice_tenant_id,
    ARRAY['owner']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'invoice is unavailable for adjustment' USING ERRCODE = '42501';
  END IF;

  new_paid := invoice_paid + adjustment_amount_cents;
  IF adjustment_amount_cents IS NULL OR adjustment_amount_cents = 0
    OR new_paid < 0 OR new_paid > invoice_total
    OR char_length(trim(adjustment_reason)) NOT BETWEEN 3 AND 500
  THEN
    RAISE EXCEPTION 'invoice adjustment is invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payment_records (
    tenant_id, invoice_id, record_type, amount_cents, method, source,
    note, received_at, recorded_by_user_id
  ) VALUES (
    invoice_tenant_id, target_invoice_id, 'adjustment', adjustment_amount_cents,
    'other', 'manual', trim(adjustment_reason), now(), auth.uid()
  )
  RETURNING id INTO adjustment_id;

  UPDATE public.invoices
  SET paid_cents = new_paid,
      status = CASE
        WHEN new_paid = invoice_total THEN 'paid'::public.invoice_status
        WHEN new_paid = 0 THEN 'sent'::public.invoice_status
        ELSE 'partially_paid'::public.invoice_status
      END
  WHERE id = target_invoice_id;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    invoice_tenant_id, auth.uid(), 'invoice.payment_adjusted', 'invoice',
    target_invoice_id, jsonb_build_object(
      'payment_record_id', adjustment_id,
      'amount_cents', adjustment_amount_cents,
      'reason', trim(adjustment_reason)
    )
  );

  RETURN adjustment_id;
END;
$$;

CREATE FUNCTION public.void_invoice(target_invoice_id uuid, reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  invoice_tenant_id uuid;
BEGIN
  SELECT invoice.tenant_id
  INTO invoice_tenant_id
  FROM public.invoices AS invoice
  WHERE invoice.id = target_invoice_id
    AND invoice.status IN ('draft', 'sent')
    AND invoice.paid_cents = 0
  FOR UPDATE;

  IF invoice_tenant_id IS NULL OR NOT public.current_user_has_tenant_role(
    invoice_tenant_id,
    ARRAY['owner']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'invoice is unavailable for voiding' USING ERRCODE = '42501';
  END IF;

  IF char_length(trim(reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'invoice void reason is required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.invoices
  SET status = 'void', voided_at = now(), void_reason = trim(reason)
  WHERE id = target_invoice_id;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    invoice_tenant_id, auth.uid(), 'invoice.voided', 'invoice', target_invoice_id,
    jsonb_build_object('reason', trim(reason))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_job_invoice(uuid, jsonb, bigint, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_job_invoice(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_invoice(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_manual_invoice_payment(uuid, bigint, public.payment_method, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_invoice_adjustment(uuid, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.void_invoice(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.save_job_invoice(uuid, jsonb, bigint, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_job_invoice(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_invoice(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_manual_invoice_payment(uuid, bigint, public.payment_method, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_invoice_adjustment(uuid, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_invoice(uuid, text) TO authenticated;

COMMENT ON TABLE public.invoices IS
  'Tenant invoice snapshots. External payment URLs belong to the service business; CrewFlow never confirms payment from a link click.';
COMMENT ON TABLE public.payment_records IS
  'Append-only payment and adjustment ledger with explicit source attribution.';
