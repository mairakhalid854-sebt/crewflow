-- Spanish for customers.
--
-- Each customer has a preferred language (English by default). Customers
-- who prefer Spanish receive appointment, quote, invoice, work report, and
-- quote reminder emails in Spanish. The Spanish wording is fixed,
-- human-written text, not machine translation, so nothing costs money or
-- can be mistranslated. Business-written content such as job titles and
-- line items is shown as the business wrote it. Staff emails stay English.

ALTER TABLE public.customers
  ADD COLUMN preferred_language text NOT NULL DEFAULT 'en',
  ADD CONSTRAINT customers_preferred_language CHECK (
    preferred_language IN ('en', 'es')
  );

-- "martes, 10 de noviembre" / "10 de noviembre de 2026" in the given zone.
CREATE FUNCTION public.spanish_date(
  target_time timestamptz,
  target_zone text,
  include_weekday boolean,
  include_year boolean
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH local_time AS (
    SELECT target_time AT TIME ZONE target_zone AS value
  )
  SELECT
    CASE WHEN include_weekday THEN
      (ARRAY['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'])
        [extract(dow FROM local_time.value)::integer + 1] || ', '
    ELSE '' END
    || extract(day FROM local_time.value)::integer
    || ' de '
    || (ARRAY['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
        'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'])
        [extract(month FROM local_time.value)::integer]
    || CASE WHEN include_year
      THEN ' de ' || extract(year FROM local_time.value)::integer
      ELSE '' END
  FROM local_time;
$$;

-- "10:00 a. m." in the given zone.
CREATE FUNCTION public.spanish_time(target_time timestamptz, target_zone text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT to_char(target_time AT TIME ZONE target_zone, 'FMHH12:MI')
    || CASE WHEN extract(hour FROM target_time AT TIME ZONE target_zone) < 12
      THEN ' a. m.' ELSE ' p. m.' END;
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
  customer_language text;
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
    tenant.time_zone, customer.preferred_language
  INTO recipient, greeting_name, business_name, business_time_zone,
    customer_language
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

  IF customer_language = 'es' THEN
    when_text := public.spanish_date(appointment_start, business_time_zone, true, false)
      || ' de ' || public.spanish_time(appointment_start, business_time_zone)
      || CASE WHEN appointment_end IS NOT NULL THEN
        ' a ' || public.spanish_time(appointment_end, business_time_zone)
      ELSE '' END
      || ' (hora local de ' || business_name || ')';
    IF email_kind = 'job_scheduled' THEN
      email_subject := format('Su cita con %s está confirmada', business_name);
      email_body := format(
        E'Hola %s:\n\n%s programó "%s" para el %s.\n\n¿Necesita cambiar la hora? Responda a este correo para comunicarse directamente con %s.\n\nEnviado por ' || public.product_brand_name() || E' en nombre de %s.',
        greeting_name, business_name, job_title, when_text, business_name, business_name
      );
    ELSIF email_kind = 'job_rescheduled' THEN
      email_subject := format('Su cita con %s tiene un nuevo horario', business_name);
      email_body := format(
        E'Hola %s:\n\n%s cambió el horario de "%s". Ahora está programado para el %s.\n\n¿Necesita cambiar la hora? Responda a este correo para comunicarse directamente con %s.\n\nEnviado por ' || public.product_brand_name() || E' en nombre de %s.',
        greeting_name, business_name, job_title, when_text, business_name, business_name
      );
    ELSE
      email_subject := format('Su cita con %s fue cancelada', business_name);
      email_body := format(
        E'Hola %s:\n\n%s canceló la cita de "%s" que estaba programada para el %s.\n\nPara volver a programarla o hacer una pregunta, responda a este correo para comunicarse directamente con %s.\n\nEnviado por ' || public.product_brand_name() || E' en nombre de %s.',
        greeting_name, business_name, job_title, when_text, business_name, business_name
      );
    END IF;
  ELSE
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
  customer_language text;
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
      quote.total_cents, quote.currency_code, quote.expires_at,
      customer.preferred_language
    INTO email_tenant_id, recipient, greeting_name, amount_cents, currency, deadline,
      customer_language
    FROM public.quotes AS quote
    JOIN public.customers AS customer
      ON customer.id = quote.customer_id AND customer.tenant_id = quote.tenant_id
    WHERE quote.id = target_entity_id AND quote.decision_token_hash = hashed;
    allowed_roles := ARRAY['owner', 'office']::public.membership_role[];
    email_link_path := '/quote/' || link_token;
  ELSIF target_kind = 'invoice' THEN
    SELECT invoice.tenant_id, lower(customer.email), customer.first_name,
      invoice.total_cents - invoice.paid_cents, invoice.currency_code,
      invoice.due_at, invoice.invoice_number, customer.preferred_language
    INTO email_tenant_id, recipient, greeting_name, amount_cents, currency,
      deadline, document_number, customer_language
    FROM public.invoices AS invoice
    JOIN public.customers AS customer
      ON customer.id = invoice.customer_id AND customer.tenant_id = invoice.tenant_id
    WHERE invoice.id = target_entity_id AND invoice.public_token_hash = hashed;
    allowed_roles := ARRAY['owner', 'office']::public.membership_role[];
    email_link_path := '/invoice/' || link_token;
  ELSIF target_kind = 'work_report' THEN
    SELECT report.tenant_id, lower(customer.email), customer.first_name, job.title,
      customer.preferred_language
    INTO email_tenant_id, recipient, greeting_name, job_title, customer_language
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

  IF customer_language = 'es' AND target_kind IN ('quote', 'invoice', 'work_report') THEN
    date_text := public.spanish_date(deadline, business_time_zone, false, true);
    IF target_kind = 'quote' THEN
      email_subject := format('Su cotización de %s', business_name);
      email_body := format(
        E'Hola %s:\n\n%s le envió una cotización por %s. Revísela y acéptela o rechácela aquí:\n\n{{link}}\n\nEste enlace vence el %s. Responda a este correo para comunicarse directamente con %s.\n\nEnviado por ' || public.product_brand_name() || E' en nombre de %s.',
        greeting_name, business_name, money_text, date_text, business_name, business_name
      );
    ELSIF target_kind = 'invoice' THEN
      email_subject := format('Factura n.º %s de %s', document_number, business_name);
      email_body := format(
        E'Hola %s:\n\n%s le envió la factura n.º %s. Monto a pagar: %s, con vencimiento el %s.\n\nVea la factura y las opciones de pago aquí:\n\n{{link}}\n\nResponda a este correo para comunicarse directamente con %s.\n\nEnviado por ' || public.product_brand_name() || E' en nombre de %s.',
        greeting_name, business_name, document_number, money_text, date_text,
        business_name, business_name
      );
    ELSE
      email_subject := format('Su informe de servicio de %s', business_name);
      email_body := format(
        E'Hola %s:\n\n%s compartió el informe de servicio de "%s". Vea el trabajo realizado y las recomendaciones aquí:\n\n{{link}}\n\nResponda a este correo para comunicarse directamente con %s.\n\nEnviado por ' || public.product_brand_name() || E' en nombre de %s.',
        greeting_name, business_name,
        regexp_replace(coalesce(job_title, ''), '[[:cntrl:]]', '', 'g'),
        business_name, business_name
      );
    END IF;
  ELSE
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

CREATE OR REPLACE FUNCTION public.queue_quote_follow_ups(target_now timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  candidate record;
  milestone integer;
  greeting text;
  email_subject text;
  email_body text;
  queued_total integer := 0;
  inserted integer;
BEGIN
  IF session_user <> 'postgres'
    AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF target_now IS NULL THEN
    RAISE EXCEPTION 'follow-up time is required' USING ERRCODE = '22023';
  END IF;

  FOR candidate IN
    SELECT
      quote.id AS quote_id,
      quote.tenant_id,
      quote.total_cents,
      quote.sent_at,
      quote.expires_at,
      tenant.time_zone,
      regexp_replace(tenant.display_name, '[[:cntrl:]]', '', 'g') AS business_name,
      regexp_replace(coalesce(job.title, ''), '[[:cntrl:]]', '', 'g') AS job_title,
      regexp_replace(coalesce(customer.first_name, ''), '[[:cntrl:]]', '', 'g') AS first_name,
      lower(customer.email) AS email,
      customer.preferred_language AS language,
      (target_now AT TIME ZONE tenant.time_zone)::date
        - (quote.sent_at AT TIME ZONE tenant.time_zone)::date AS days_waiting
    FROM public.quotes AS quote
    JOIN public.tenants AS tenant ON tenant.id = quote.tenant_id
    JOIN public.tenant_settings AS setting ON setting.tenant_id = quote.tenant_id
    JOIN public.customers AS customer
      ON customer.id = quote.customer_id AND customer.tenant_id = quote.tenant_id
    JOIN public.jobs AS job
      ON job.id = quote.job_id AND job.tenant_id = quote.tenant_id
    WHERE setting.quote_follow_up_emails_enabled
      AND quote.status = 'sent'
      AND quote.sent_at IS NOT NULL
      AND quote.expires_at > target_now
      AND customer.archived_at IS NULL
      AND customer.email_suppressed_at IS NULL
      AND customer.transactional_email_allowed
      AND customer.email IS NOT NULL
      AND extract(hour FROM target_now AT TIME ZONE tenant.time_zone) = 10
  LOOP
    IF candidate.days_waiting NOT IN (3, 7) THEN
      CONTINUE;
    END IF;
    milestone := candidate.days_waiting;
    IF candidate.language = 'es' THEN
      greeting := CASE WHEN nullif(trim(candidate.first_name), '') IS NULL
        THEN 'Hola:' ELSE 'Hola ' || trim(candidate.first_name) || ':' END;
      email_subject := CASE milestone
        WHEN 3 THEN format('Su cotización de %s', candidate.business_name)
        ELSE format('¿Todavía lo está pensando? Su cotización de %s', candidate.business_name)
      END;
      email_body := format(
        E'%s\n\n%s le envió una cotización por "%s" (%s) el %s. Queríamos asegurarnos de que la haya recibido.\n\nLa cotización está disponible hasta el %s. Puede revisarla, aceptarla o rechazarla desde el enlace de nuestro correo anterior, o simplemente responder a este mensaje si tiene preguntas.\n\nGracias,\n%s\n\nEnviado por CrewFlow360 en nombre de %s.',
        greeting,
        candidate.business_name,
        candidate.job_title,
        public.format_usd_cents(candidate.total_cents),
        public.spanish_date(candidate.sent_at, candidate.time_zone, false, false),
        public.spanish_date(candidate.expires_at, candidate.time_zone, false, false),
        candidate.business_name,
        candidate.business_name
      );
    ELSE
      greeting := coalesce(nullif(trim(candidate.first_name), ''), 'there');

      email_subject := CASE milestone
        WHEN 3 THEN format('Your quote from %s', candidate.business_name)
        ELSE format('Still thinking it over? Your quote from %s', candidate.business_name)
      END;
      email_body := format(
        E'Hi %s,\n\n%s sent you a quote for "%s" (%s) on %s. We wanted to make sure it reached you.\n\nThe quote is open until %s. You can review, accept, or decline it from the link in our earlier email, or simply reply to this message with any questions.\n\nThank you,\n%s\n\nSent by CrewFlow360 on behalf of %s.',
        greeting,
        candidate.business_name,
        candidate.job_title,
        public.format_usd_cents(candidate.total_cents),
        to_char(candidate.sent_at AT TIME ZONE candidate.time_zone, 'FMMonth FMDD'),
        to_char(candidate.expires_at AT TIME ZONE candidate.time_zone, 'FMMonth FMDD'),
        candidate.business_name,
        candidate.business_name
      );
    END IF;

    INSERT INTO public.transactional_emails (
      tenant_id, kind, entity_id, token_hash, to_email, subject, body,
      link_path, status, requested_by_user_id
    ) VALUES (
      candidate.tenant_id,
      'quote_reminder',
      candidate.quote_id,
      public.quote_reminder_email_hash(candidate.quote_id, milestone),
      candidate.email,
      left(email_subject, 240),
      left(email_body, 4000),
      NULL,
      'ready',
      NULL
    )
    ON CONFLICT (tenant_id, kind, token_hash) DO NOTHING;
    GET DIAGNOSTICS inserted = ROW_COUNT;
    queued_total := queued_total + inserted;
  END LOOP;

  RETURN queued_total;
END;
$$;
