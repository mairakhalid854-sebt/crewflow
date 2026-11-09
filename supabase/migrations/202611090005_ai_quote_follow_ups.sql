-- AI Follow-up: automatic quote reminders.
--
-- Owners opt in from Settings (OFF by default). Once a day at 10 AM local
-- time, every quote that is still waiting for a customer decision 3 or 7
-- days after it was sent gets one polite, link-free reminder on the existing
-- transactional queue. The quote link is never re-issued, so the customer's
-- original link keeps working. A reminder is cancelled at send time if the
-- customer has decided, the quote expired, the workspace turned reminders
-- off, or the customer may no longer be emailed.

ALTER TABLE public.tenant_settings
  ADD COLUMN quote_follow_up_emails_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.transactional_emails
  DROP CONSTRAINT transactional_emails_content_bounds,
  DROP CONSTRAINT transactional_emails_link_lifecycle,
  ADD CONSTRAINT transactional_emails_content_bounds CHECK (
    char_length(subject) BETWEEN 1 AND 240
    AND char_length(body) BETWEEN 1 AND 4000
    AND (
      (
        kind IN (
          'job_scheduled', 'job_rescheduled', 'job_cancelled',
          'owner_daily_summary', 'owner_weekly_summary', 'quote_reminder'
        )
        AND position('{{link}}' IN body) = 0
      )
      OR (
        kind NOT IN (
          'job_scheduled', 'job_rescheduled', 'job_cancelled',
          'owner_daily_summary', 'owner_weekly_summary', 'quote_reminder'
        )
        AND position('{{link}}' IN body) > 0
      )
    )
  ),
  ADD CONSTRAINT transactional_emails_link_lifecycle CHECK (
    (
      kind IN (
        'job_scheduled', 'job_rescheduled', 'job_cancelled',
        'owner_daily_summary', 'owner_weekly_summary', 'quote_reminder'
      )
      AND link_path IS NULL
    )
    OR (
      kind NOT IN (
        'job_scheduled', 'job_rescheduled', 'job_cancelled',
        'owner_daily_summary', 'owner_weekly_summary', 'quote_reminder'
      )
      AND (
        (status IN ('ready', 'processing') AND link_path IS NOT NULL)
        OR (status IN ('delivered', 'failed', 'cancelled') AND link_path IS NULL)
      )
    )
  );

CREATE FUNCTION public.quote_reminder_email_hash(
  target_quote_id uuid,
  target_milestone_day integer
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        concat_ws('|', 'quote_reminder', target_quote_id::text,
          target_milestone_day::text),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

-- True while the quote still waits for a decision, reminders are on, and the
-- customer may still be emailed at that address.
CREATE FUNCTION public.quote_reminder_email_is_current(
  target_quote_id uuid,
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
    FROM public.quotes AS quote
    JOIN public.customers AS customer
      ON customer.id = quote.customer_id AND customer.tenant_id = quote.tenant_id
    JOIN public.tenant_settings AS setting
      ON setting.tenant_id = quote.tenant_id
    WHERE quote.id = target_quote_id
      AND quote.tenant_id = target_tenant_id
      AND quote.status = 'sent'
      AND quote.expires_at > now()
      AND setting.quote_follow_up_emails_enabled
      AND customer.archived_at IS NULL
      AND customer.email_suppressed_at IS NULL
      AND customer.transactional_email_allowed
      AND lower(customer.email) = target_email
      AND target_token_hash IN (
        public.quote_reminder_email_hash(quote.id, 3),
        public.quote_reminder_email_hash(quote.id, 7)
      )
  );
$$;

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
    WHEN 'owner_daily_summary' THEN public.owner_summary_email_is_current(
      target_kind, target_tenant_id, target_email
    )
    WHEN 'owner_weekly_summary' THEN public.owner_summary_email_is_current(
      target_kind, target_tenant_id, target_email
    )
    WHEN 'quote_reminder' THEN public.quote_reminder_email_is_current(
      target_entity_id, target_tenant_id, target_token_hash, target_email
    )
    ELSE false
  END;
$$;

CREATE FUNCTION public.queue_quote_follow_ups(target_now timestamptz)
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

REVOKE ALL ON FUNCTION public.queue_quote_follow_ups(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_quote_follow_ups(timestamptz) TO service_role;

DO $$
DECLARE existing_job_id bigint;
BEGIN
  SELECT jobid INTO existing_job_id
  FROM cron.job WHERE jobname = 'crewflow-quote-follow-ups' LIMIT 1;
  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;
  PERFORM cron.schedule(
    'crewflow-quote-follow-ups',
    '20 * * * *',
    'SELECT public.queue_quote_follow_ups(now());'
  );
END;
$$;

COMMENT ON FUNCTION public.queue_quote_follow_ups(timestamptz) IS
  'Hourly service-only job: at 10 AM local, queues one link-free reminder per open quote on day 3 and day 7 after sending.';
