-- Customer- and crew-facing text names the product through one function, so a
-- future rename is a single CREATE OR REPLACE of public.product_brand_name()
-- instead of rewriting every template. The bodies below are copied unchanged
-- from their latest migrations except that the literal brand is replaced by a
-- call; rendered text is identical while the function returns 'CrewFlow'.

CREATE FUNCTION public.product_brand_name()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT 'CrewFlow'::text
$$;

REVOKE ALL ON FUNCTION public.product_brand_name() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.product_brand_name() IS
  'Product name used in emails, push notifications, and signature consent. Must not contain % because templates pass it through format(). STABLE, not IMMUTABLE, so cached plans pick up a replacement.';

CREATE OR REPLACE FUNCTION public.record_assigned_job_signature(
  target_job_id uuid,
  customer_signer_name text,
  accepted_consent_text text,
  signature_strokes jsonb
)
RETURNS TABLE (
  signature_id uuid,
  signed_at timestamptz,
  integrity_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  required_consent CONSTANT text :=
    'I confirm that the work described above was completed and authorize this electronic signature to be attached to this ' || public.product_brand_name() || ' job.';
  locked_job public.jobs%ROWTYPE;
  normalized_signer_name text := trim(coalesce(customer_signer_name, ''));
  signature_stroke jsonb;
  signature_point jsonb;
  point_x numeric;
  point_y numeric;
  new_signature_id uuid := extensions.gen_random_uuid();
  signature_signed_at timestamptz := clock_timestamp();
  signature_integrity_hash text;
  integrity_payload jsonb;
BEGIN
  IF char_length(normalized_signer_name) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'signer name must be between 2 and 120 characters'
      USING ERRCODE = '22023';
  END IF;

  IF accepted_consent_text IS DISTINCT FROM required_consent THEN
    RAISE EXCEPTION 'the required customer consent was not accepted'
      USING ERRCODE = '22023';
  END IF;

  IF signature_strokes IS NULL
    OR jsonb_typeof(signature_strokes) <> 'array'
    OR jsonb_array_length(signature_strokes) NOT BETWEEN 1 AND 40
    OR octet_length(signature_strokes::text) > 100000 THEN
    RAISE EXCEPTION 'signature strokes are missing or exceed allowed limits'
      USING ERRCODE = '22023';
  END IF;

  FOR signature_stroke IN
    SELECT value FROM jsonb_array_elements(signature_strokes)
  LOOP
    IF jsonb_typeof(signature_stroke) <> 'array'
      OR jsonb_array_length(signature_stroke) NOT BETWEEN 2 AND 500 THEN
      RAISE EXCEPTION 'each signature stroke must contain 2 to 500 points'
        USING ERRCODE = '22023';
    END IF;

    FOR signature_point IN
      SELECT value FROM jsonb_array_elements(signature_stroke)
    LOOP
      IF jsonb_typeof(signature_point) <> 'object'
        OR jsonb_typeof(signature_point -> 'x') <> 'number'
        OR jsonb_typeof(signature_point -> 'y') <> 'number' THEN
        RAISE EXCEPTION 'signature points require numeric x and y coordinates'
          USING ERRCODE = '22023';
      END IF;

      point_x := (signature_point ->> 'x')::numeric;
      point_y := (signature_point ->> 'y')::numeric;
      IF point_x NOT BETWEEN 0 AND 1 OR point_y NOT BETWEEN 0 AND 1 THEN
        RAISE EXCEPTION 'signature points must use normalized coordinates'
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END LOOP;

  SELECT job.*
  INTO locked_job
  FROM public.jobs AS job
  JOIN public.memberships AS membership
    ON membership.id = job.assigned_membership_id
    AND membership.tenant_id = job.tenant_id
  WHERE job.id = target_job_id
    AND job.archived_at IS NULL
    AND membership.user_id = auth.uid()
    AND membership.role = 'technician'
    AND membership.status = 'active'
  FOR UPDATE OF job;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'assigned job not found or unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF locked_job.status <> 'in_progress' THEN
    RAISE EXCEPTION 'customer signature requires in-progress work'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.job_signatures AS existing_signature
    WHERE existing_signature.job_id = locked_job.id
  ) THEN
    RAISE EXCEPTION 'a customer signature is already recorded for this job'
      USING ERRCODE = '23505';
  END IF;

  integrity_payload := jsonb_build_object(
    'captured_by_membership_id', locked_job.assigned_membership_id,
    'consent_text', required_consent,
    'job_id', locked_job.id,
    'signature_id', new_signature_id,
    'signature_strokes', signature_strokes,
    'signed_at', signature_signed_at,
    'signer_name', normalized_signer_name,
    'tenant_id', locked_job.tenant_id
  );
  signature_integrity_hash := encode(
    extensions.digest(
      convert_to(integrity_payload::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.job_signatures (
    id,
    tenant_id,
    job_id,
    captured_by_membership_id,
    signer_name,
    consent_text,
    signature_strokes,
    signed_at,
    integrity_hash
  )
  VALUES (
    new_signature_id,
    locked_job.tenant_id,
    locked_job.id,
    locked_job.assigned_membership_id,
    normalized_signer_name,
    required_consent,
    signature_strokes,
    signature_signed_at,
    signature_integrity_hash
  );

  INSERT INTO public.audit_events (
    tenant_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  VALUES (
    locked_job.tenant_id,
    auth.uid(),
    'job.customer_signature_recorded',
    'job',
    locked_job.id,
    jsonb_build_object(
      'signature_id', new_signature_id,
      'signed_at', signature_signed_at,
      'signer_name', normalized_signer_name,
      'integrity_hash', signature_integrity_hash
    )
  );

  RETURN QUERY
  SELECT new_signature_id, signature_signed_at, signature_integrity_hash;
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_job_push_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  event_kind public.push_notification_kind;
  event_title text;
  event_body text;
  recipient_membership_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_membership_id IS NULL THEN
      RETURN NEW;
    END IF;
    event_kind := 'job_assigned';
    event_title := 'New ' || public.product_brand_name() || ' assignment';
    event_body := 'Open ' || public.product_brand_name() || ' to review your new job assignment.';
    recipient_membership_id := NEW.assigned_membership_id;
  ELSIF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    recipient_membership_id := coalesce(
      NEW.assigned_membership_id,
      OLD.assigned_membership_id
    );
    IF recipient_membership_id IS NULL THEN
      RETURN NEW;
    END IF;
    event_kind := 'job_cancelled';
    event_title := public.product_brand_name() || ' job cancelled';
    event_body := 'An assigned job was cancelled. Open ' || public.product_brand_name() || ' for details.';
  ELSIF NEW.assigned_membership_id IS DISTINCT FROM OLD.assigned_membership_id
    AND NEW.assigned_membership_id IS NOT NULL THEN
    event_kind := 'job_assigned';
    event_title := 'New ' || public.product_brand_name() || ' assignment';
    event_body := 'Open ' || public.product_brand_name() || ' to review your new job assignment.';
    recipient_membership_id := NEW.assigned_membership_id;
  ELSIF NEW.assigned_membership_id IS NOT NULL
    AND (
      NEW.scheduled_start_at IS DISTINCT FROM OLD.scheduled_start_at
      OR NEW.scheduled_end_at IS DISTINCT FROM OLD.scheduled_end_at
    ) THEN
    event_kind := 'job_rescheduled';
    event_title := public.product_brand_name() || ' schedule updated';
    event_body := 'An assigned job schedule changed. Open ' || public.product_brand_name() || ' for details.';
    recipient_membership_id := NEW.assigned_membership_id;
  ELSE
    RETURN NEW;
  END IF;

  PERFORM public.enqueue_push_notification_event(
    NEW.tenant_id,
    recipient_membership_id,
    event_kind,
    NEW.id,
    'job',
    NEW.id,
    event_title,
    event_body,
    'crewflow://jobs/' || NEW.id::text,
    event_kind::text || ':' || NEW.id::text || ':'
      || recipient_membership_id::text || ':' || NEW.updated_at::text
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_approval_push_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  recipient record;
  approval_kind text;
  approval_title text;
BEGIN
  approval_kind := CASE TG_TABLE_NAME
    WHEN 'quotes' THEN 'quote'
    WHEN 'invoices' THEN 'invoice'
    WHEN 'work_reports' THEN 'report'
  END;
  approval_title := CASE TG_TABLE_NAME
    WHEN 'quotes' THEN 'Quote ready for approval'
    WHEN 'invoices' THEN 'Invoice ready for approval'
    WHEN 'work_reports' THEN 'Work report ready for approval'
  END;

  IF approval_kind IS NULL THEN
    RETURN NEW;
  END IF;

  FOR recipient IN
    SELECT membership.id
    FROM public.memberships AS membership
    WHERE membership.tenant_id = NEW.tenant_id
      AND membership.status = 'active'
      AND membership.role IN ('owner', 'office')
      AND membership.user_id IS DISTINCT FROM auth.uid()
  LOOP
    PERFORM public.enqueue_push_notification_event(
      NEW.tenant_id,
      recipient.id,
      'approval_requested',
      NEW.job_id,
      CASE TG_TABLE_NAME
        WHEN 'work_reports' THEN 'work_report'
        ELSE TG_TABLE_NAME
      END,
      NEW.id,
      approval_title,
      'A customer document is ready for review in ' || public.product_brand_name() || '.',
      'crewflow://approvals/' || approval_kind || '/' || NEW.id::text,
      'approval_requested:' || approval_kind || ':' || NEW.id::text || ':'
        || recipient.id::text
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_job_status_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  email_kind public.transactional_email_kind;
  email_hash text;
  recipient text;
  greeting_name text;
  business_name text;
  business_time_zone text;
  job_title text;
  appointment_start timestamptz;
  appointment_end timestamptz;
  when_text text;
  email_subject text;
  email_body text;
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status = 'scheduled' THEN
    email_kind := 'job_cancelled';
    appointment_start := OLD.scheduled_start_at;
    appointment_end := OLD.scheduled_end_at;
    email_hash := public.job_status_email_hash(email_kind, NEW.id, NULL, NULL);
  ELSIF NEW.status = 'scheduled' AND OLD.status IS DISTINCT FROM 'scheduled' THEN
    email_kind := 'job_scheduled';
  ELSIF NEW.status = 'scheduled'
    AND (
      NEW.scheduled_start_at IS DISTINCT FROM OLD.scheduled_start_at
      OR NEW.scheduled_end_at IS DISTINCT FROM OLD.scheduled_end_at
    ) THEN
    email_kind := 'job_rescheduled';
  ELSE
    RETURN NEW;
  END IF;

  IF email_kind <> 'job_cancelled' THEN
    appointment_start := NEW.scheduled_start_at;
    appointment_end := NEW.scheduled_end_at;
    IF appointment_start IS NULL OR appointment_start <= now() THEN
      RETURN NEW;
    END IF;
    email_hash := public.job_status_email_hash(
      email_kind, NEW.id, appointment_start, appointment_end
    );
  END IF;

  SELECT lower(customer.email), customer.first_name,
    regexp_replace(tenant.display_name, '[[:cntrl:]]', '', 'g'),
    tenant.time_zone
  INTO recipient, greeting_name, business_name, business_time_zone
  FROM public.customers AS customer
  JOIN public.tenants AS tenant ON tenant.id = customer.tenant_id
  JOIN public.tenant_settings AS setting ON setting.tenant_id = customer.tenant_id
  WHERE customer.id = NEW.customer_id
    AND customer.tenant_id = NEW.tenant_id
    AND setting.customer_appointment_emails_enabled
    AND customer.archived_at IS NULL
    AND customer.email_suppressed_at IS NULL
    AND customer.transactional_email_allowed
    AND customer.email IS NOT NULL;
  IF recipient IS NULL OR appointment_start IS NULL THEN
    RETURN NEW;
  END IF;

  greeting_name := regexp_replace(coalesce(greeting_name, ''), '[[:cntrl:]]', '', 'g');
  job_title := regexp_replace(coalesce(NEW.title, ''), '[[:cntrl:]]', '', 'g');
  when_text := to_char(appointment_start AT TIME ZONE business_time_zone, 'FMDay, FMMonth FMDD')
    || ' from '
    || to_char(appointment_start AT TIME ZONE business_time_zone, 'FMHH12:MI AM')
    || CASE WHEN appointment_end IS NOT NULL THEN
      ' to ' || to_char(appointment_end AT TIME ZONE business_time_zone, 'FMHH12:MI AM')
    ELSE '' END
    || ' (' || business_name || ' local time)';

  IF email_kind = 'job_scheduled' THEN
    email_subject := format('Your appointment with %s is confirmed', business_name);
    email_body := format(
      E'Hi %s,\n\n%s has scheduled "%s" for %s.\n\nNeed to change the time? Reply to this email to reach %s directly.\n\nSent by ' || public.product_brand_name() || E' on behalf of %s.',
      greeting_name, business_name, job_title, when_text, business_name, business_name
    );
  ELSIF email_kind = 'job_rescheduled' THEN
    email_subject := format('Your appointment with %s has a new time', business_name);
    email_body := format(
      E'Hi %s,\n\n%s has updated the time for "%s". It is now scheduled for %s.\n\nNeed to change the time? Reply to this email to reach %s directly.\n\nSent by ' || public.product_brand_name() || E' on behalf of %s.',
      greeting_name, business_name, job_title, when_text, business_name, business_name
    );
  ELSE
    email_subject := format('Your appointment with %s was cancelled', business_name);
    email_body := format(
      E'Hi %s,\n\n%s has cancelled the appointment for "%s" that was scheduled for %s.\n\nTo rebook or ask a question, reply to this email to reach %s directly.\n\nSent by ' || public.product_brand_name() || E' on behalf of %s.',
      greeting_name, business_name, job_title, when_text, business_name, business_name
    );
  END IF;

  -- Email is a side effect: a constraint failure must never block the job
  -- update that triggered it.
  BEGIN
    INSERT INTO public.transactional_emails (
      tenant_id, kind, entity_id, token_hash, to_email, subject, body,
      link_path, requested_by_user_id
    ) VALUES (
      NEW.tenant_id, email_kind, NEW.id, email_hash, recipient,
      left(email_subject, 240), left(email_body, 4000), NULL, auth.uid()
    )
    ON CONFLICT (tenant_id, kind, token_hash) DO NOTHING;
  EXCEPTION
    WHEN check_violation OR not_null_violation OR string_data_right_truncation THEN
      RETURN NEW;
  END;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_transactional_email(
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
  job_title text;
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

  -- Job-status emails are queued only by the jobs trigger, never on request.
  IF target_kind NOT IN ('team_invitation', 'quote', 'invoice', 'work_report') THEN
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
  ELSIF target_kind = 'work_report' THEN
    SELECT report.tenant_id, lower(customer.email), customer.first_name, job.title
    INTO email_tenant_id, recipient, greeting_name, job_title
    FROM public.work_reports AS report
    JOIN public.customers AS customer
      ON customer.id = report.customer_id AND customer.tenant_id = report.tenant_id
    JOIN public.jobs AS job
      ON job.id = report.job_id AND job.tenant_id = report.tenant_id
    WHERE report.id = target_entity_id AND report.public_token_hash = hashed;
    allowed_roles := ARRAY['owner', 'office']::public.membership_role[];
    email_link_path := '/report/' || link_token;
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
      E'Hi %s,\n\n%s has sent you a quote for %s. Review it and accept or decline here:\n\n{{link}}\n\nThis link expires on %s. Reply to this email to reach %s directly.\n\nSent by ' || public.product_brand_name() || E' on behalf of %s.',
      greeting_name, business_name, money_text, date_text, business_name, business_name
    );
  ELSIF target_kind = 'invoice' THEN
    email_subject := format('Invoice #%s from %s', document_number, business_name);
    email_body := format(
      E'Hi %s,\n\n%s has sent you invoice #%s. Amount due: %s, due %s.\n\nView the invoice and payment options here:\n\n{{link}}\n\nReply to this email to reach %s directly.\n\nSent by ' || public.product_brand_name() || E' on behalf of %s.',
      greeting_name, business_name, document_number, money_text, date_text,
      business_name, business_name
    );
  ELSIF target_kind = 'work_report' THEN
    email_subject := format('Your service report from %s', business_name);
    email_body := format(
      E'Hi %s,\n\n%s has shared the service report for "%s". View the work performed and any recommendations here:\n\n{{link}}\n\nReply to this email to reach %s directly.\n\nSent by ' || public.product_brand_name() || E' on behalf of %s.',
      greeting_name, business_name,
      regexp_replace(coalesce(job_title, ''), '[[:cntrl:]]', '', 'g'),
      business_name, business_name
    );
  ELSE
    email_subject := format('%s invited you to ' || public.product_brand_name(), business_name);
    email_body := format(
      E'Hello,\n\n%s invited you to join their ' || public.product_brand_name() || E' workspace as %s. Create your account and accept the invitation here:\n\n{{link}}\n\nThis invitation expires on %s. If you were not expecting it, you can ignore this email.\n\nSent by ' || public.product_brand_name() || E' on behalf of %s.',
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
