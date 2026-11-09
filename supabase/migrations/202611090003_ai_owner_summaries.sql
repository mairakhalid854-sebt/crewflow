-- AI Reporting: daily and weekly business summary emails for owners.
--
-- Owners opt in from Settings (both summaries are OFF by default). An hourly
-- job finds workspaces where it is 7 AM local time and queues a link-free
-- email on the existing transactional queue for every active owner. Every
-- number comes from deterministic SQL over the workspace's own records; no
-- language model produces or rounds a figure. The dedupe hash covers the
-- workspace, kind, local date, and recipient, so a summary is queued once.

ALTER TABLE public.tenant_settings
  ADD COLUMN owner_daily_summary_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN owner_weekly_summary_enabled boolean NOT NULL DEFAULT false;

-- Owner summaries are link-free, like appointment emails.
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
          'owner_daily_summary', 'owner_weekly_summary'
        )
        AND position('{{link}}' IN body) = 0
      )
      OR (
        kind NOT IN (
          'job_scheduled', 'job_rescheduled', 'job_cancelled',
          'owner_daily_summary', 'owner_weekly_summary'
        )
        AND position('{{link}}' IN body) > 0
      )
    )
  ),
  ADD CONSTRAINT transactional_emails_link_lifecycle CHECK (
    (
      kind IN (
        'job_scheduled', 'job_rescheduled', 'job_cancelled',
        'owner_daily_summary', 'owner_weekly_summary'
      )
      AND link_path IS NULL
    )
    OR (
      kind NOT IN (
        'job_scheduled', 'job_rescheduled', 'job_cancelled',
        'owner_daily_summary', 'owner_weekly_summary'
      )
      AND (
        (status IN ('ready', 'processing') AND link_path IS NOT NULL)
        OR (status IN ('delivered', 'failed', 'cancelled') AND link_path IS NULL)
      )
    )
  );

CREATE FUNCTION public.owner_summary_email_hash(
  target_kind public.transactional_email_kind,
  target_tenant_id uuid,
  target_local_date date,
  target_email text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        concat_ws('|', target_kind::text, target_tenant_id::text,
          target_local_date::text, lower(target_email)),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

-- True while the workspace still wants this summary and the recipient is
-- still an active owner with that email address.
CREATE FUNCTION public.owner_summary_email_is_current(
  target_kind public.transactional_email_kind,
  target_tenant_id uuid,
  target_email text
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_settings AS setting
    JOIN public.memberships AS membership
      ON membership.tenant_id = setting.tenant_id
    JOIN auth.users AS account ON account.id = membership.user_id
    WHERE setting.tenant_id = target_tenant_id
      AND membership.role = 'owner'
      AND membership.status = 'active'
      AND lower(account.email) = target_email
      AND (
        (target_kind = 'owner_daily_summary' AND setting.owner_daily_summary_enabled)
        OR (target_kind = 'owner_weekly_summary' AND setting.owner_weekly_summary_enabled)
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
    ELSE false
  END;
$$;

CREATE FUNCTION public.format_usd_cents(amount bigint)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN amount < 0 THEN '-' ELSE '' END
    || '$' || trim(to_char(abs(amount) / 100.0, 'FM999,999,999,990.00'));
$$;

-- Builds the summary text for one workspace. Every figure is a direct
-- count or sum over the workspace's records in its own time zone.
CREATE FUNCTION public.build_owner_summary(
  target_tenant_id uuid,
  target_kind public.transactional_email_kind,
  target_now timestamptz
)
RETURNS TABLE (subject text, body text)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  zone text;
  business_name text;
  local_today date;
  day_start timestamptz;
  day_end timestamptz;
  period_start timestamptz;
  period_end timestamptz;
  jobs_today integer;
  unassigned_today integer;
  completed_count integer;
  received_cents bigint;
  unpaid_count integer;
  unpaid_cents bigint;
  overdue_count integer;
  overdue_cents bigint;
  quotes_waiting integer;
  quotes_waiting_cents bigint;
  quotes_expiring integer;
  quotes_sent integer;
  quotes_accepted integer;
  new_customers integer;
  pending_approvals integer;
  busiest_name text;
  busiest_count integer;
  actions text[] := ARRAY[]::text[];
  lines text[] := ARRAY[]::text[];
BEGIN
  IF target_kind NOT IN ('owner_daily_summary', 'owner_weekly_summary') THEN
    RAISE EXCEPTION 'unsupported summary kind' USING ERRCODE = '22023';
  END IF;

  SELECT tenant.time_zone,
    regexp_replace(tenant.display_name, '[[:cntrl:]]', '', 'g')
  INTO zone, business_name
  FROM public.tenants AS tenant
  WHERE tenant.id = target_tenant_id;
  IF zone IS NULL THEN
    RAISE EXCEPTION 'workspace not found' USING ERRCODE = 'P0002';
  END IF;

  local_today := (target_now AT TIME ZONE zone)::date;
  day_start := local_today::timestamp AT TIME ZONE zone;
  day_end := (local_today + 1)::timestamp AT TIME ZONE zone;
  IF target_kind = 'owner_daily_summary' THEN
    period_start := (local_today - 1)::timestamp AT TIME ZONE zone;
  ELSE
    period_start := (local_today - 7)::timestamp AT TIME ZONE zone;
  END IF;
  period_end := day_start;

  SELECT count(*)::integer,
    count(*) FILTER (WHERE job.assigned_membership_id IS NULL)::integer
  INTO jobs_today, unassigned_today
  FROM public.jobs AS job
  WHERE job.tenant_id = target_tenant_id
    AND job.archived_at IS NULL
    AND job.status IN ('scheduled', 'in_progress')
    AND job.scheduled_start_at >= day_start
    AND job.scheduled_start_at < day_end;

  SELECT count(*)::integer INTO completed_count
  FROM public.audit_events AS event
  WHERE event.tenant_id = target_tenant_id
    AND event.action = 'job.status_changed'
    AND event.metadata ->> 'to' = 'completed'
    AND event.occurred_at >= period_start
    AND event.occurred_at < period_end;

  SELECT coalesce(sum(payment.amount_cents), 0)::bigint INTO received_cents
  FROM public.payment_records AS payment
  WHERE payment.tenant_id = target_tenant_id
    AND payment.record_type = 'payment'
    AND payment.received_at >= period_start
    AND payment.received_at < period_end;

  SELECT count(*)::integer,
    coalesce(sum(invoice.total_cents - invoice.paid_cents), 0)::bigint,
    count(*) FILTER (WHERE invoice.due_at < target_now)::integer,
    coalesce(sum(invoice.total_cents - invoice.paid_cents)
      FILTER (WHERE invoice.due_at < target_now), 0)::bigint
  INTO unpaid_count, unpaid_cents, overdue_count, overdue_cents
  FROM public.invoices AS invoice
  WHERE invoice.tenant_id = target_tenant_id
    AND invoice.status IN ('sent', 'partially_paid')
    AND invoice.paid_cents < invoice.total_cents;

  SELECT count(*)::integer,
    coalesce(sum(quote.total_cents), 0)::bigint,
    count(*) FILTER (
      WHERE quote.expires_at < target_now + interval '3 days'
    )::integer
  INTO quotes_waiting, quotes_waiting_cents, quotes_expiring
  FROM public.quotes AS quote
  WHERE quote.tenant_id = target_tenant_id
    AND quote.status = 'sent'
    AND quote.expires_at > target_now;

  SELECT count(*)::integer INTO pending_approvals
  FROM public.ai_approval_requests AS approval
  WHERE approval.tenant_id = target_tenant_id
    AND approval.status = 'pending'
    AND approval.expires_at > target_now;

  IF unassigned_today > 0 THEN
    actions := actions || format(
      'Assign a technician to %s job(s) scheduled today.', unassigned_today
    );
  END IF;
  IF overdue_count > 0 THEN
    actions := actions || format(
      'Follow up on %s overdue invoice(s) totaling %s.',
      overdue_count, public.format_usd_cents(overdue_cents)
    );
  END IF;
  IF quotes_expiring > 0 THEN
    actions := actions || format(
      '%s quote(s) expire within 3 days without a customer decision.',
      quotes_expiring
    );
  END IF;
  IF pending_approvals > 0 THEN
    actions := actions || format(
      'Review %s AI suggestion(s) waiting in AI operations.', pending_approvals
    );
  END IF;

  IF target_kind = 'owner_daily_summary' THEN
    subject := format('Your day at %s: %s job(s) today', business_name, jobs_today);
    lines := ARRAY[
      format('Good morning! Here is %s for %s.', business_name,
        to_char(local_today, 'FMDay, FMMonth FMDD')),
      '',
      'TODAY',
      format('- Jobs scheduled: %s', jobs_today),
      format('- Without a technician: %s', unassigned_today),
      '',
      'YESTERDAY',
      format('- Jobs completed: %s', completed_count),
      format('- Payments recorded: %s', public.format_usd_cents(received_cents))
    ];
  ELSE
    SELECT count(*)::integer INTO quotes_sent
    FROM public.quotes AS quote
    WHERE quote.tenant_id = target_tenant_id
      AND quote.sent_at >= period_start AND quote.sent_at < period_end;

    SELECT count(*)::integer INTO quotes_accepted
    FROM public.quotes AS quote
    WHERE quote.tenant_id = target_tenant_id
      AND quote.accepted_at >= period_start AND quote.accepted_at < period_end;

    SELECT count(*)::integer INTO new_customers
    FROM public.customers AS customer
    WHERE customer.tenant_id = target_tenant_id
      AND customer.created_at >= period_start AND customer.created_at < period_end;

    SELECT nullif(trim(profile.full_name), ''), count(*)::integer
    INTO busiest_name, busiest_count
    FROM public.audit_events AS event
    JOIN public.jobs AS job
      ON job.id = event.entity_id AND job.tenant_id = event.tenant_id
    JOIN public.memberships AS membership
      ON membership.id = job.assigned_membership_id
    LEFT JOIN public.profiles AS profile ON profile.user_id = membership.user_id
    WHERE event.tenant_id = target_tenant_id
      AND event.action = 'job.status_changed'
      AND event.metadata ->> 'to' = 'completed'
      AND event.occurred_at >= period_start
      AND event.occurred_at < period_end
    GROUP BY membership.id, profile.full_name
    ORDER BY count(*) DESC, profile.full_name
    LIMIT 1;

    subject := format('Your week at %s: %s received',
      business_name, public.format_usd_cents(received_cents));
    lines := ARRAY[
      format('Here is %s for the 7 days ending %s.', business_name,
        to_char(local_today - 1, 'FMMonth FMDD')),
      '',
      'LAST 7 DAYS',
      format('- Payments recorded: %s', public.format_usd_cents(received_cents)),
      format('- Jobs completed: %s', completed_count),
      format('- New customers: %s', new_customers),
      format('- Quotes sent: %s, accepted: %s', quotes_sent, quotes_accepted)
    ];
    IF busiest_count IS NOT NULL THEN
      lines := lines || format('- Most completed jobs: %s (%s)',
        regexp_replace(coalesce(busiest_name, 'A technician'), '[[:cntrl:]]', '', 'g'),
        busiest_count);
    END IF;
    lines := lines || ARRAY[
      '',
      'THIS WEEK',
      format('- Jobs scheduled today: %s', jobs_today)
    ];
  END IF;

  lines := lines || ARRAY[
    '',
    'MONEY WAITING',
    format('- Unpaid invoices: %s (%s)', unpaid_count,
      public.format_usd_cents(unpaid_cents)),
    format('- Overdue: %s (%s)', overdue_count,
      public.format_usd_cents(overdue_cents)),
    format('- Quotes waiting for a customer decision: %s (%s)', quotes_waiting,
      public.format_usd_cents(quotes_waiting_cents)),
    '',
    'SUGGESTED NEXT STEPS'
  ];
  IF cardinality(actions) = 0 THEN
    lines := lines || '- Nothing needs your attention right now.'::text;
  ELSE
    lines := lines || ARRAY(SELECT '- ' || item FROM unnest(actions) AS item);
  END IF;
  lines := lines || ARRAY[
    '',
    'Figures come straight from your CrewFlow360 records. Payments include only amounts recorded in CrewFlow360.',
    'Turn this summary off any time in Settings.'
  ];

  body := left(array_to_string(lines, E'\n'), 4000);
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.build_owner_summary(uuid, public.transactional_email_kind, timestamptz)
  FROM PUBLIC, anon, authenticated;

-- Lets an owner see exactly what the summary would say right now.
CREATE FUNCTION public.preview_owner_summary(
  target_tenant_id uuid,
  target_kind public.transactional_email_kind
)
RETURNS TABLE (subject text, body text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.current_user_has_tenant_role(
    target_tenant_id, ARRAY['owner']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'only an active owner can preview summaries'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT summary.subject, summary.body
  FROM public.build_owner_summary(target_tenant_id, target_kind, now()) AS summary;
END;
$$;

REVOKE ALL ON FUNCTION public.preview_owner_summary(uuid, public.transactional_email_kind)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_owner_summary(uuid, public.transactional_email_kind)
  TO authenticated;

CREATE FUNCTION public.queue_owner_summaries(target_now timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  workspace record;
  recipient record;
  summary record;
  kind_to_send public.transactional_email_kind;
  local_now timestamp;
  queued_total integer := 0;
  inserted integer;
BEGIN
  IF session_user <> 'postgres'
    AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF target_now IS NULL THEN
    RAISE EXCEPTION 'summary time is required' USING ERRCODE = '22023';
  END IF;

  FOR workspace IN
    SELECT tenant.id, tenant.time_zone,
      setting.owner_daily_summary_enabled,
      setting.owner_weekly_summary_enabled
    FROM public.tenants AS tenant
    JOIN public.tenant_settings AS setting ON setting.tenant_id = tenant.id
    WHERE setting.owner_daily_summary_enabled
       OR setting.owner_weekly_summary_enabled
  LOOP
    local_now := target_now AT TIME ZONE workspace.time_zone;
    IF extract(hour FROM local_now) <> 7 THEN
      CONTINUE;
    END IF;

    FOREACH kind_to_send IN ARRAY ARRAY[
      'owner_daily_summary', 'owner_weekly_summary'
    ]::public.transactional_email_kind[]
    LOOP
      IF kind_to_send = 'owner_daily_summary'
        AND NOT workspace.owner_daily_summary_enabled THEN
        CONTINUE;
      END IF;
      IF kind_to_send = 'owner_weekly_summary'
        AND (
          NOT workspace.owner_weekly_summary_enabled
          OR extract(isodow FROM local_now) <> 1
        ) THEN
        CONTINUE;
      END IF;

      BEGIN
        SELECT built.subject, built.body INTO summary
        FROM public.build_owner_summary(workspace.id, kind_to_send, target_now) AS built;

        FOR recipient IN
          SELECT DISTINCT lower(account.email) AS email, membership.user_id
          FROM public.memberships AS membership
          JOIN auth.users AS account ON account.id = membership.user_id
          WHERE membership.tenant_id = workspace.id
            AND membership.role = 'owner'
            AND membership.status = 'active'
            AND account.email IS NOT NULL
        LOOP
          INSERT INTO public.transactional_emails (
            tenant_id, kind, entity_id, token_hash, to_email, subject, body,
            link_path, status, requested_by_user_id
          ) VALUES (
            workspace.id,
            kind_to_send,
            workspace.id,
            public.owner_summary_email_hash(
              kind_to_send, workspace.id, local_now::date, recipient.email
            ),
            recipient.email,
            left(summary.subject, 240),
            summary.body,
            NULL,
            'ready',
            NULL
          )
          ON CONFLICT (tenant_id, kind, token_hash) DO NOTHING;
          GET DIAGNOSTICS inserted = ROW_COUNT;
          queued_total := queued_total + inserted;
        END LOOP;
      EXCEPTION WHEN OTHERS THEN
        -- One workspace's data problem must not block everyone else's summary.
        RAISE WARNING 'owner summary skipped for workspace %: %',
          workspace.id, SQLERRM;
      END;
    END LOOP;
  END LOOP;

  RETURN queued_total;
END;
$$;

REVOKE ALL ON FUNCTION public.queue_owner_summaries(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_owner_summaries(timestamptz) TO service_role;

DO $$
DECLARE existing_job_id bigint;
BEGIN
  SELECT jobid INTO existing_job_id
  FROM cron.job WHERE jobname = 'crewflow-owner-summaries' LIMIT 1;
  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;
  PERFORM cron.schedule(
    'crewflow-owner-summaries',
    '5 * * * *',
    'SELECT public.queue_owner_summaries(now());'
  );
END;
$$;

COMMENT ON FUNCTION public.build_owner_summary(uuid, public.transactional_email_kind, timestamptz) IS
  'Deterministic owner summary text. Every figure is a direct count or sum; no model output.';
COMMENT ON FUNCTION public.queue_owner_summaries(timestamptz) IS
  'Hourly service-only job: queues opted-in daily (7 AM local) and Monday weekly owner summaries once per recipient per day.';
