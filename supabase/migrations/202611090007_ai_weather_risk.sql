-- Weather Risk Alert.
--
-- Owners mark outdoor services as weather-sensitive and opt in to alerts
-- (both OFF by default). At 4 PM local time an Edge Function checks
-- tomorrow's scheduled weather-sensitive jobs against the free US National
-- Weather Service hourly forecast for the job window, records the risk per
-- job, and queues one link-free email per active owner when any job is at
-- risk. Coordinates come from the free US Census geocoder and are cached per
-- customer address. Nothing is rescheduled automatically.

ALTER TABLE public.services
  ADD COLUMN weather_sensitive boolean NOT NULL DEFAULT false;

ALTER TABLE public.tenant_settings
  ADD COLUMN weather_alerts_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE public.customer_geocodes (
  customer_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  address_hash text NOT NULL,
  status text NOT NULL,
  latitude numeric(8, 5),
  longitude numeric(8, 5),
  geocoded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_geocodes_customer_tenant_fk
    FOREIGN KEY (customer_id, tenant_id)
    REFERENCES public.customers(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT customer_geocodes_hash_format CHECK (address_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT customer_geocodes_shape CHECK (
    (status = 'matched'
      AND latitude IS NOT NULL
      AND longitude IS NOT NULL
      AND latitude BETWEEN -90 AND 90
      AND longitude BETWEEN -180 AND 180)
    OR (status = 'no_match' AND latitude IS NULL AND longitude IS NULL)
  )
);

CREATE TABLE public.job_weather_risks (
  job_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  forecast_date date NOT NULL,
  risk_level text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_weather_risks_job_tenant_fk
    FOREIGN KEY (job_id, tenant_id)
    REFERENCES public.jobs(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT job_weather_risks_level CHECK (
    risk_level IN ('clear', 'watch', 'high', 'unavailable')
  ),
  CONSTRAINT job_weather_risks_summary_length CHECK (
    char_length(summary) BETWEEN 1 AND 300
  ),
  CONSTRAINT job_weather_risks_details_shape CHECK (
    jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 4000
  )
);

CREATE INDEX job_weather_risks_tenant_date_idx
  ON public.job_weather_risks (tenant_id, forecast_date);

ALTER TABLE public.customer_geocodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_weather_risks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_geocodes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.job_weather_risks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.job_weather_risks TO authenticated;

CREATE POLICY job_weather_risks_select ON public.job_weather_risks
  FOR SELECT TO authenticated
  USING (
    public.current_user_has_tenant_role(
      tenant_id, ARRAY['owner', 'office']::public.membership_role[]
    )
  );

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
          'owner_daily_summary', 'owner_weekly_summary', 'quote_reminder',
          'weather_risk_alert'
        )
        AND position('{{link}}' IN body) = 0
      )
      OR (
        kind NOT IN (
          'job_scheduled', 'job_rescheduled', 'job_cancelled',
          'owner_daily_summary', 'owner_weekly_summary', 'quote_reminder',
          'weather_risk_alert'
        )
        AND position('{{link}}' IN body) > 0
      )
    )
  ),
  ADD CONSTRAINT transactional_emails_link_lifecycle CHECK (
    (
      kind IN (
        'job_scheduled', 'job_rescheduled', 'job_cancelled',
        'owner_daily_summary', 'owner_weekly_summary', 'quote_reminder',
        'weather_risk_alert'
      )
      AND link_path IS NULL
    )
    OR (
      kind NOT IN (
        'job_scheduled', 'job_rescheduled', 'job_cancelled',
        'owner_daily_summary', 'owner_weekly_summary', 'quote_reminder',
        'weather_risk_alert'
      )
      AND (
        (status IN ('ready', 'processing') AND link_path IS NOT NULL)
        OR (status IN ('delivered', 'failed', 'cancelled') AND link_path IS NULL)
      )
    )
  );

CREATE FUNCTION public.customer_address_hash(
  street text, city text, state_code text, postal_code text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        lower(concat_ws('|',
          coalesce(trim(street), ''), coalesce(trim(city), ''),
          coalesce(trim(state_code), ''), coalesce(trim(postal_code), ''))),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

-- Jobs the 4 PM check should look at right now: tomorrow's scheduled jobs
-- for weather-sensitive services in workspaces that turned alerts on.
CREATE FUNCTION public.list_weather_check_jobs(target_now timestamptz)
RETURNS TABLE (
  job_id uuid,
  tenant_id uuid,
  forecast_date date,
  time_zone text,
  job_title text,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  customer_id uuid,
  customer_name text,
  street_address text,
  city text,
  state_code text,
  postal_code text,
  address_hash text,
  geocode_status text,
  latitude numeric,
  longitude numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF session_user <> 'postgres'
    AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    job.id,
    job.tenant_id,
    (target_now AT TIME ZONE tenant.time_zone)::date + 1,
    tenant.time_zone,
    job.title,
    job.scheduled_start_at,
    job.scheduled_end_at,
    customer.id,
    trim(concat_ws(' ', customer.first_name, customer.last_name)),
    customer.street_address,
    customer.city,
    customer.state_code,
    customer.postal_code,
    public.customer_address_hash(
      customer.street_address, customer.city,
      customer.state_code, customer.postal_code
    ),
    geocode.status,
    geocode.latitude,
    geocode.longitude
  FROM public.jobs AS job
  JOIN public.tenants AS tenant ON tenant.id = job.tenant_id
  JOIN public.tenant_settings AS setting ON setting.tenant_id = job.tenant_id
  JOIN public.services AS service
    ON service.id = job.service_id AND service.tenant_id = job.tenant_id
  JOIN public.customers AS customer
    ON customer.id = job.customer_id AND customer.tenant_id = job.tenant_id
  LEFT JOIN public.customer_geocodes AS geocode
    ON geocode.customer_id = customer.id
   AND geocode.address_hash = public.customer_address_hash(
     customer.street_address, customer.city,
     customer.state_code, customer.postal_code
   )
  WHERE setting.weather_alerts_enabled
    AND service.weather_sensitive
    AND job.status = 'scheduled'
    AND job.archived_at IS NULL
    AND job.scheduled_start_at IS NOT NULL
    AND extract(hour FROM target_now AT TIME ZONE tenant.time_zone) = 16
    AND (job.scheduled_start_at AT TIME ZONE tenant.time_zone)::date
      = (target_now AT TIME ZONE tenant.time_zone)::date + 1
  ORDER BY job.tenant_id, job.scheduled_start_at
  LIMIT 500;
END;
$$;

CREATE FUNCTION public.record_customer_geocode(
  target_customer_id uuid,
  target_tenant_id uuid,
  target_address_hash text,
  target_status text,
  target_latitude numeric,
  target_longitude numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF session_user <> 'postgres'
    AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.customer_geocodes (
    customer_id, tenant_id, address_hash, status, latitude, longitude, geocoded_at
  ) VALUES (
    target_customer_id, target_tenant_id, target_address_hash, target_status,
    CASE WHEN target_status = 'matched' THEN round(target_latitude, 5) END,
    CASE WHEN target_status = 'matched' THEN round(target_longitude, 5) END,
    now()
  )
  ON CONFLICT (customer_id) DO UPDATE
  SET address_hash = EXCLUDED.address_hash,
      status = EXCLUDED.status,
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      geocoded_at = EXCLUDED.geocoded_at
  WHERE public.customer_geocodes.tenant_id = EXCLUDED.tenant_id;
END;
$$;

CREATE FUNCTION public.record_job_weather_risk(
  target_job_id uuid,
  target_tenant_id uuid,
  target_forecast_date date,
  target_risk_level text,
  target_summary text,
  target_details jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF session_user <> 'postgres'
    AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.job_weather_risks (
    job_id, tenant_id, forecast_date, risk_level, summary, details, checked_at
  ) VALUES (
    target_job_id, target_tenant_id, target_forecast_date, target_risk_level,
    left(regexp_replace(target_summary, '[[:cntrl:]]', ' ', 'g'), 300),
    coalesce(target_details, '{}'::jsonb),
    now()
  )
  ON CONFLICT (job_id) DO UPDATE
  SET forecast_date = EXCLUDED.forecast_date,
      risk_level = EXCLUDED.risk_level,
      summary = EXCLUDED.summary,
      details = EXCLUDED.details,
      checked_at = EXCLUDED.checked_at
  WHERE public.job_weather_risks.tenant_id = EXCLUDED.tenant_id;
END;
$$;

CREATE FUNCTION public.weather_alert_email_hash(
  target_tenant_id uuid,
  target_forecast_date date,
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
        concat_ws('|', 'weather_risk_alert', target_tenant_id::text,
          target_forecast_date::text, lower(target_email)),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

CREATE FUNCTION public.weather_alert_email_is_current(
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
      AND setting.weather_alerts_enabled
      AND membership.role = 'owner'
      AND membership.status = 'active'
      AND lower(account.email) = target_email
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
    WHEN 'weather_risk_alert' THEN public.weather_alert_email_is_current(
      target_tenant_id, target_email
    )
    ELSE false
  END;
$$;

-- Queues one alert per active owner when any of tomorrow's checked jobs is
-- at risk. Returns the number of emails queued.
CREATE FUNCTION public.queue_weather_risk_alert(
  target_tenant_id uuid,
  target_forecast_date date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  zone text;
  business_name text;
  risk record;
  recipient record;
  lines text[] := ARRAY[]::text[];
  high_count integer := 0;
  watch_count integer := 0;
  email_subject text;
  email_body text;
  queued_total integer := 0;
  inserted integer;
BEGIN
  IF session_user <> 'postgres'
    AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  SELECT tenant.time_zone,
    regexp_replace(tenant.display_name, '[[:cntrl:]]', '', 'g')
  INTO zone, business_name
  FROM public.tenants AS tenant
  JOIN public.tenant_settings AS setting ON setting.tenant_id = tenant.id
  WHERE tenant.id = target_tenant_id
    AND setting.weather_alerts_enabled;
  IF zone IS NULL THEN
    RETURN 0;
  END IF;

  FOR risk IN
    SELECT weather.risk_level, weather.summary, job.scheduled_start_at,
      regexp_replace(coalesce(job.title, ''), '[[:cntrl:]]', '', 'g') AS title,
      regexp_replace(coalesce(customer.city, ''), '[[:cntrl:]]', '', 'g') AS city
    FROM public.job_weather_risks AS weather
    JOIN public.jobs AS job
      ON job.id = weather.job_id AND job.tenant_id = weather.tenant_id
    JOIN public.customers AS customer
      ON customer.id = job.customer_id AND customer.tenant_id = job.tenant_id
    WHERE weather.tenant_id = target_tenant_id
      AND weather.forecast_date = target_forecast_date
      AND weather.risk_level IN ('high', 'watch')
      AND job.status = 'scheduled'
      AND job.archived_at IS NULL
    ORDER BY weather.risk_level = 'high' DESC, job.scheduled_start_at
  LOOP
    IF risk.risk_level = 'high' THEN
      high_count := high_count + 1;
    ELSE
      watch_count := watch_count + 1;
    END IF;
    lines := lines || format('- [%s] %s %s%s: %s',
      upper(risk.risk_level),
      to_char(risk.scheduled_start_at AT TIME ZONE zone, 'FMHH12:MI AM'),
      risk.title,
      CASE WHEN risk.city <> '' THEN ' (' || risk.city || ')' ELSE '' END,
      risk.summary
    );
  END LOOP;

  IF high_count + watch_count = 0 THEN
    RETURN 0;
  END IF;

  email_subject := format('Weather alert: %s outdoor job(s) at risk tomorrow',
    high_count + watch_count);
  email_body := left(array_to_string(
    ARRAY[
      format('Weather check for %s, %s.', business_name,
        to_char(target_forecast_date, 'FMDay, FMMonth FMDD')),
      '',
      format('%s job(s) at high risk and %s to watch:', high_count, watch_count),
      ''
    ] || lines || ARRAY[
      '',
      'Consider calling these customers or moving the work in Dispatch. Nothing has been rescheduled automatically.',
      '',
      'Forecast: US National Weather Service (weather.gov), checked at 4 PM local time. Forecasts can change overnight.',
      'Turn weather alerts off any time in Settings.'
    ],
    E'\n'
  ), 4000);

  FOR recipient IN
    SELECT DISTINCT lower(account.email) AS email
    FROM public.memberships AS membership
    JOIN auth.users AS account ON account.id = membership.user_id
    WHERE membership.tenant_id = target_tenant_id
      AND membership.role = 'owner'
      AND membership.status = 'active'
      AND account.email IS NOT NULL
  LOOP
    INSERT INTO public.transactional_emails (
      tenant_id, kind, entity_id, token_hash, to_email, subject, body,
      link_path, status, requested_by_user_id
    ) VALUES (
      target_tenant_id,
      'weather_risk_alert',
      target_tenant_id,
      public.weather_alert_email_hash(
        target_tenant_id, target_forecast_date, recipient.email
      ),
      recipient.email,
      left(email_subject, 240),
      email_body,
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

REVOKE ALL ON FUNCTION public.list_weather_check_jobs(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_customer_geocode(uuid, uuid, text, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_job_weather_risk(uuid, uuid, date, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_weather_risk_alert(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_weather_check_jobs(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_customer_geocode(uuid, uuid, text, text, numeric, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_job_weather_risk(uuid, uuid, date, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_weather_risk_alert(uuid, date) TO service_role;

-- Schedules the hourly Edge Function call. Run once after deploying
-- weather-risk-check; it needs the shared CrewFlow cron vault secrets.
CREATE FUNCTION public.configure_weather_risk_cron()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  existing_job_id bigint;
  scheduled_job_id bigint;
BEGIN
  IF session_user <> 'postgres'
    AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vault.secrets WHERE name = 'crewflow_project_url'
  ) OR NOT EXISTS (
    SELECT 1 FROM vault.secrets WHERE name = 'crewflow_edge_function_service_key'
  ) THEN
    RAISE EXCEPTION 'shared CrewFlow cron secrets are not configured'
      USING ERRCODE = '55000';
  END IF;

  SELECT jobid INTO existing_job_id
  FROM cron.job WHERE jobname = 'crewflow-weather-risk-check' LIMIT 1;
  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  SELECT cron.schedule(
    'crewflow-weather-risk-check',
    '35 * * * *',
    $command$
      SELECT net.http_post(
        url := (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'crewflow_project_url'
        ) || '/functions/v1/weather-risk-check',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'crewflow_edge_function_service_key'
          )
        ),
        body := jsonb_build_object('scheduled_at', now()),
        timeout_milliseconds := 60000
      ) AS request_id;
    $command$
  ) INTO scheduled_job_id;

  RETURN scheduled_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.configure_weather_risk_cron() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_weather_risk_cron() TO service_role;

COMMENT ON TABLE public.job_weather_risks IS
  'Latest weather check per job from the 4 PM NWS forecast. Advisory only; nothing is rescheduled.';
COMMENT ON TABLE public.customer_geocodes IS
  'Cached US Census geocoder result per customer address (invalidated when the address changes).';
