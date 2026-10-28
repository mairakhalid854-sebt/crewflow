-- CrewFlow Phase 7: automatic customer appointment emails. When a job is
-- scheduled, rescheduled, or cancelled, a trigger queues a server-rendered,
-- link-free email on the transactional queue. The dedupe hash covers the job
-- and appointment window, so a later reschedule supersedes an unsent earlier
-- email at claim time. Owners can turn these emails off per workspace, and
-- a job update never fails because an email could not be queued.

ALTER TABLE public.tenant_settings
  ADD COLUMN customer_appointment_emails_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.transactional_emails
  DROP CONSTRAINT transactional_emails_content_bounds,
  DROP CONSTRAINT transactional_emails_link_lifecycle,
  ADD CONSTRAINT transactional_emails_content_bounds CHECK (
    char_length(subject) BETWEEN 1 AND 240
    AND char_length(body) BETWEEN 1 AND 4000
    AND (
      (
        kind IN ('job_scheduled', 'job_rescheduled', 'job_cancelled')
        AND position('{{link}}' IN body) = 0
      )
      OR (
        kind NOT IN ('job_scheduled', 'job_rescheduled', 'job_cancelled')
        AND position('{{link}}' IN body) > 0
      )
    )
  ),
  ADD CONSTRAINT transactional_emails_link_lifecycle CHECK (
    (
      kind IN ('job_scheduled', 'job_rescheduled', 'job_cancelled')
      AND link_path IS NULL
    )
    OR (
      kind NOT IN ('job_scheduled', 'job_rescheduled', 'job_cancelled')
      AND (
        (status IN ('ready', 'processing') AND link_path IS NOT NULL)
        OR (status IN ('delivered', 'failed', 'cancelled') AND link_path IS NULL)
      )
    )
  );

CREATE FUNCTION public.job_status_email_hash(
  target_kind public.transactional_email_kind,
  target_job_id uuid,
  window_start timestamptz,
  window_end timestamptz
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        concat_ws('|', target_kind::text, target_job_id::text,
          coalesce(window_start::text, ''), coalesce(window_end::text, '')),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

-- True while the job is still in the state the email describes, the
-- workspace still sends appointment emails, and the customer may be emailed.
CREATE FUNCTION public.job_status_email_is_current(
  target_kind public.transactional_email_kind,
  target_job_id uuid,
  target_tenant_id uuid,
  target_token_hash text,
  target_email text
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.jobs AS job
    JOIN public.customers AS customer
      ON customer.id = job.customer_id AND customer.tenant_id = job.tenant_id
    JOIN public.tenant_settings AS setting
      ON setting.tenant_id = job.tenant_id
    WHERE job.id = target_job_id
      AND job.tenant_id = target_tenant_id
      AND setting.customer_appointment_emails_enabled
      AND customer.archived_at IS NULL
      AND customer.email_suppressed_at IS NULL
      AND customer.transactional_email_allowed
      AND lower(customer.email) = target_email
      AND (
        (
          target_kind IN ('job_scheduled', 'job_rescheduled')
          AND job.status = 'scheduled'
          AND job.archived_at IS NULL
          AND job.scheduled_start_at > now()
          AND public.job_status_email_hash(
            target_kind, job.id, job.scheduled_start_at, job.scheduled_end_at
          ) = target_token_hash
        )
        OR (
          target_kind = 'job_cancelled'
          AND job.status = 'cancelled'
          AND public.job_status_email_hash(target_kind, job.id, NULL, NULL)
            = target_token_hash
        )
      )
  );
$$;

CREATE FUNCTION public.queue_job_status_email()
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
      E'Hi %s,\n\n%s has scheduled "%s" for %s.\n\nNeed to change the time? Reply to this email to reach %s directly.\n\nSent by CrewFlow on behalf of %s.',
      greeting_name, business_name, job_title, when_text, business_name, business_name
    );
  ELSIF email_kind = 'job_rescheduled' THEN
    email_subject := format('Your appointment with %s has a new time', business_name);
    email_body := format(
      E'Hi %s,\n\n%s has updated the time for "%s". It is now scheduled for %s.\n\nNeed to change the time? Reply to this email to reach %s directly.\n\nSent by CrewFlow on behalf of %s.',
      greeting_name, business_name, job_title, when_text, business_name, business_name
    );
  ELSE
    email_subject := format('Your appointment with %s was cancelled', business_name);
    email_body := format(
      E'Hi %s,\n\n%s has cancelled the appointment for "%s" that was scheduled for %s.\n\nTo rebook or ask a question, reply to this email to reach %s directly.\n\nSent by CrewFlow on behalf of %s.',
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

CREATE TRIGGER jobs_queue_customer_status_email
AFTER UPDATE OF status, scheduled_start_at, scheduled_end_at ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.queue_job_status_email();

CREATE OR REPLACE FUNCTION public.transactional_email_is_current(
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
    WHEN 'work_report' THEN EXISTS (
      SELECT 1
      FROM public.work_reports AS report
      JOIN public.customers AS customer
        ON customer.id = report.customer_id AND customer.tenant_id = report.tenant_id
      WHERE report.id = target_entity_id
        AND report.tenant_id = target_tenant_id
        AND report.status = 'sent'
        AND report.public_token_hash = target_token_hash
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
    WHEN 'job_scheduled' THEN public.job_status_email_is_current(
      target_kind, target_entity_id, target_tenant_id, target_token_hash, target_email
    )
    WHEN 'job_rescheduled' THEN public.job_status_email_is_current(
      target_kind, target_entity_id, target_tenant_id, target_token_hash, target_email
    )
    WHEN 'job_cancelled' THEN public.job_status_email_is_current(
      target_kind, target_entity_id, target_tenant_id, target_token_hash, target_email
    )
    ELSE false
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
  ELSIF target_kind = 'work_report' THEN
    email_subject := format('Your service report from %s', business_name);
    email_body := format(
      E'Hi %s,\n\n%s has shared the service report for "%s". View the work performed and any recommendations here:\n\n{{link}}\n\nReply to this email to reach %s directly.\n\nSent by CrewFlow on behalf of %s.',
      greeting_name, business_name,
      regexp_replace(coalesce(job_title, ''), '[[:cntrl:]]', '', 'g'),
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

REVOKE ALL ON FUNCTION public.job_status_email_hash(
  public.transactional_email_kind, uuid, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.job_status_email_is_current(
  public.transactional_email_kind, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_job_status_email()
  FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.tenant_settings.customer_appointment_emails_enabled IS
  'When true, customers with transactional email permission receive appointment confirmation, change, and cancellation emails.';
COMMENT ON FUNCTION public.queue_job_status_email() IS
  'Queues a link-free customer email when a job is scheduled, rescheduled, or cancelled. Never blocks the job update.';
