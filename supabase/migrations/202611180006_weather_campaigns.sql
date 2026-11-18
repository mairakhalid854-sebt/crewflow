-- Weather-triggered campaigns (Batch 1, feature 4).
--
-- Before a heat wave or a freeze near the business, CrewFlow360 drafts an
-- email to past customers who agreed to marketing email ("Heat wave coming:
-- is your AC ready?") with the business's booking link. The owner reviews
-- and sends it, or turns on auto-send. Forecasts come from the free US
-- National Weather Service through the weather-campaign-check function.
--
-- Marketing rules: only opted-in, non-suppressed customers with an email and
-- a past completed job; every message carries the unsubscribe link and the
-- business postal address (added by the sender); delivery stays held unless
-- the operator switch CREWFLOW_MARKETING_EMAIL_ENABLED is on. Off by default.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.weather_campaign_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT false,
  heat_threshold_f integer NOT NULL DEFAULT 95,
  cold_threshold_f integer NOT NULL DEFAULT 25,
  auto_send boolean NOT NULL DEFAULT false,
  cooldown_days integer NOT NULL DEFAULT 21,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weather_campaign_settings_heat CHECK (heat_threshold_f BETWEEN 80 AND 120),
  CONSTRAINT weather_campaign_settings_cold CHECK (cold_threshold_f BETWEEN -20 AND 40),
  CONSTRAINT weather_campaign_settings_cooldown CHECK (cooldown_days BETWEEN 7 AND 90)
);

CREATE TABLE public.weather_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  source text NOT NULL DEFAULT 'forecast',
  forecast_date date,
  forecast_temp_f integer,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  audience_count integer NOT NULL DEFAULT 0,
  queued_count integer NOT NULL DEFAULT 0,
  approved_at timestamptz,
  approved_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weather_campaigns_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT weather_campaigns_kind CHECK (kind IN ('heat', 'cold')),
  CONSTRAINT weather_campaigns_source CHECK (source IN ('forecast', 'manual')),
  CONSTRAINT weather_campaigns_status CHECK (status IN ('draft', 'sent', 'cancelled')),
  CONSTRAINT weather_campaigns_subject_length CHECK (char_length(subject) BETWEEN 3 AND 150),
  CONSTRAINT weather_campaigns_body_length CHECK (char_length(body) BETWEEN 20 AND 2000),
  CONSTRAINT weather_campaigns_lifecycle CHECK (
    (status = 'draft' AND approved_at IS NULL AND cancelled_at IS NULL)
    OR (status = 'sent' AND approved_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status = 'cancelled' AND cancelled_at IS NOT NULL)
  )
);

CREATE INDEX weather_campaigns_tenant_idx
  ON public.weather_campaigns (tenant_id, created_at DESC);

CREATE TABLE public.campaign_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  booking_path text,
  status text NOT NULL DEFAULT 'ready',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  provider_message_id text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_messages_campaign_fk FOREIGN KEY (campaign_id, tenant_id)
    REFERENCES public.weather_campaigns(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT campaign_messages_customer_fk FOREIGN KEY (customer_id, tenant_id)
    REFERENCES public.customers(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT campaign_messages_once UNIQUE (campaign_id, customer_id),
  CONSTRAINT campaign_messages_status CHECK (
    status IN ('ready', 'processing', 'delivered', 'failed', 'cancelled')
  ),
  CONSTRAINT campaign_messages_email_length CHECK (char_length(to_email) BETWEEN 3 AND 320),
  CONSTRAINT campaign_messages_booking_path CHECK (
    booking_path IS NULL OR booking_path ~ '^/book/[a-z0-9-]{3,48}$'
  ),
  CONSTRAINT campaign_messages_attempts CHECK (attempt_count BETWEEN 0 AND 5)
);

CREATE INDEX campaign_messages_claim_idx
  ON public.campaign_messages (status, next_attempt_at)
  WHERE status IN ('ready', 'processing');
CREATE INDEX campaign_messages_customer_idx
  ON public.campaign_messages (tenant_id, customer_id, created_at DESC);

CREATE TRIGGER weather_campaign_settings_updated_at
BEFORE UPDATE ON public.weather_campaign_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER weather_campaigns_updated_at
BEFORE UPDATE ON public.weather_campaigns
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER campaign_messages_updated_at
BEFORE UPDATE ON public.campaign_messages
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER weather_campaign_settings_require_write_entitlement
BEFORE INSERT OR UPDATE OR DELETE ON public.weather_campaign_settings
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_write_entitlement();

ALTER TABLE public.weather_campaign_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weather_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.weather_campaign_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.weather_campaigns FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.campaign_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.weather_campaign_settings TO authenticated;
GRANT SELECT ON public.weather_campaigns TO authenticated;

CREATE POLICY weather_campaign_settings_select ON public.weather_campaign_settings
  FOR SELECT TO authenticated
  USING (
    public.current_user_has_tenant_role(tenant_id, ARRAY['owner']::public.membership_role[])
  );
CREATE POLICY weather_campaigns_select ON public.weather_campaigns
  FOR SELECT TO authenticated
  USING (
    public.current_user_has_tenant_role(tenant_id, ARRAY['owner']::public.membership_role[])
  );

-- ---------------------------------------------------------------------------
-- Audience and drafting (internal)
-- ---------------------------------------------------------------------------

-- Past customers who may receive a weather campaign: opted in to marketing,
-- reachable by email, at least one completed job, no open job, and not sent
-- a weather campaign within the cooldown.
CREATE FUNCTION public.weather_campaign_audience(target_tenant_id uuid)
RETURNS TABLE (customer_id uuid, email text, first_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT customer.id, lower(customer.email), customer.first_name
  FROM public.customers AS customer
  WHERE customer.tenant_id = target_tenant_id
    AND customer.archived_at IS NULL
    AND customer.marketing_email_opted_in
    AND customer.email_suppressed_at IS NULL
    AND nullif(btrim(customer.email), '') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.jobs AS job
      WHERE job.tenant_id = customer.tenant_id
        AND job.customer_id = customer.id
        AND job.status IN ('completed', 'closed')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.jobs AS job
      WHERE job.tenant_id = customer.tenant_id
        AND job.customer_id = customer.id
        AND job.archived_at IS NULL
        AND job.status IN ('new', 'quoted', 'accepted', 'scheduled', 'in_progress')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.campaign_messages AS message
      JOIN public.weather_campaign_settings AS setting
        ON setting.tenant_id = message.tenant_id
      WHERE message.tenant_id = customer.tenant_id
        AND message.customer_id = customer.id
        AND message.status <> 'cancelled'
        AND message.created_at > now() - make_interval(days => setting.cooldown_days)
    );
$$;

REVOKE ALL ON FUNCTION public.weather_campaign_audience(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.weather_campaign_email_hash(target_campaign_id uuid, target_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        concat_ws('|', 'weather_campaign_ready', target_campaign_id::text, lower(target_email)),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

CREATE FUNCTION public.weather_campaign_owner_email_is_current(
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
    FROM public.weather_campaign_settings AS setting
    JOIN public.memberships AS membership ON membership.tenant_id = setting.tenant_id
    JOIN auth.users AS account ON account.id = membership.user_id
    WHERE setting.tenant_id = target_tenant_id
      AND setting.enabled
      AND membership.role = 'owner'
      AND membership.status = 'active'
      AND lower(account.email) = target_email
  );
$$;

-- Creates a draft campaign with ready-to-send wording. Returns NULL when a
-- campaign of this kind exists within the cooldown, or nobody qualifies.
CREATE FUNCTION public.draft_weather_campaign(
  target_tenant_id uuid,
  target_kind text,
  target_source text,
  target_forecast_date date,
  target_forecast_temp_f integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  setting public.weather_campaign_settings%ROWTYPE;
  tenant public.tenants%ROWTYPE;
  live_slug text;
  audience integer;
  when_label text;
  action_line text;
  draft_subject text;
  draft_body text;
  new_campaign uuid;
  recipient record;
BEGIN
  IF target_kind NOT IN ('heat', 'cold') THEN
    RAISE EXCEPTION 'unknown campaign kind' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO setting FROM public.weather_campaign_settings AS candidate
  WHERE candidate.tenant_id = target_tenant_id;
  SELECT * INTO tenant FROM public.tenants AS candidate
  WHERE candidate.id = target_tenant_id;

  IF EXISTS (
    SELECT 1 FROM public.weather_campaigns AS earlier
    WHERE earlier.tenant_id = target_tenant_id
      AND earlier.kind = target_kind
      AND (
        earlier.status = 'draft'
        OR earlier.created_at > now() - make_interval(days => coalesce(setting.cooldown_days, 21))
      )
  ) THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO audience FROM public.weather_campaign_audience(target_tenant_id);
  IF audience = 0 THEN
    RETURN NULL;
  END IF;

  SELECT page.slug INTO live_slug FROM public.booking_pages AS page
  WHERE page.tenant_id = target_tenant_id
    AND public.live_booking_tenant(page.slug) IS NOT NULL;

  when_label := CASE WHEN target_forecast_date IS NOT NULL
    THEN to_char(target_forecast_date, 'FMDay, FMMonth FMDD') END;
  action_line := CASE
    WHEN live_slug IS NOT NULL THEN 'Book a visit online in a minute: {{booking_link}}'
    WHEN tenant.phone IS NOT NULL THEN 'Call us at ' || tenant.phone || ' to book a visit.'
    ELSE 'Reply to this email to book a visit.'
  END;

  IF target_kind = 'heat' THEN
    draft_subject := 'Heat wave coming: is your AC ready?';
    draft_body := array_to_string(ARRAY[
      'Hi {{first_name}},',
      '',
      CASE WHEN target_forecast_temp_f IS NOT NULL AND when_label IS NOT NULL
        THEN format('The forecast shows temperatures up to %s°F around %s.',
          target_forecast_temp_f, when_label)
        ELSE 'Hot weather is on the way.' END,
      'A quick AC check now can prevent a breakdown on the hottest day of the year, when repair crews are busiest.',
      '',
      action_line,
      '',
      'Stay cool,',
      tenant.display_name
    ], E'\n');
  ELSE
    draft_subject := 'Freezing weather ahead: is your heat ready?';
    draft_body := array_to_string(ARRAY[
      'Hi {{first_name}},',
      '',
      CASE WHEN target_forecast_temp_f IS NOT NULL AND when_label IS NOT NULL
        THEN format('The forecast shows lows down to %s°F around %s.',
          target_forecast_temp_f, when_label)
        ELSE 'Cold weather is on the way.' END,
      'A quick heating check now can prevent a cold night without heat, and frozen pipes.',
      '',
      action_line,
      '',
      'Stay warm,',
      tenant.display_name
    ], E'\n');
  END IF;

  INSERT INTO public.weather_campaigns (
    tenant_id, kind, source, forecast_date, forecast_temp_f, subject, body,
    audience_count
  ) VALUES (
    target_tenant_id, target_kind, target_source, target_forecast_date,
    target_forecast_temp_f, draft_subject, draft_body, audience
  ) RETURNING id INTO new_campaign;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    target_tenant_id, auth.uid(), 'weather_campaign.drafted', 'tenant', target_tenant_id,
    jsonb_build_object(
      'campaign_id', new_campaign, 'kind', target_kind, 'source', target_source,
      'audience_count', audience
    )
  );

  IF target_source = 'forecast' AND setting.auto_send THEN
    PERFORM public.queue_weather_campaign(new_campaign, NULL);
  END IF;

  IF target_source = 'forecast' THEN
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
        target_tenant_id, 'weather_campaign_ready', new_campaign,
        public.weather_campaign_email_hash(new_campaign, recipient.email),
        recipient.email,
        CASE WHEN setting.auto_send
          THEN format('Weather campaign sent to %s past customers', audience)
          ELSE format('Weather campaign ready for %s past customers', audience) END,
        array_to_string(ARRAY[
          CASE WHEN target_kind = 'heat'
            THEN format('A heat wave is in the forecast for %s.', coalesce(when_label, 'the coming days'))
            ELSE format('Freezing weather is in the forecast for %s.', coalesce(when_label, 'the coming days')) END,
          '',
          CASE WHEN setting.auto_send
            THEN format('Auto-send is on, so a check-up email went to %s past customers who agreed to hear from you.', audience)
            ELSE format('A check-up email to %s past customers who agreed to hear from you is ready. Open Campaigns in CrewFlow360 to review and send it.', audience) END,
          '',
          'Turn weather campaigns off any time in Campaigns.'
        ], E'\n'),
        NULL, 'ready', NULL
      )
      ON CONFLICT (tenant_id, kind, token_hash) DO NOTHING;
    END LOOP;
  END IF;

  RETURN new_campaign;
END;
$$;

REVOKE ALL ON FUNCTION public.draft_weather_campaign(uuid, text, text, date, integer)
  FROM PUBLIC, anon, authenticated;

-- Queues one message per audience member and marks the campaign sent.
CREATE FUNCTION public.queue_weather_campaign(
  target_campaign_id uuid,
  target_actor uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  campaign public.weather_campaigns%ROWTYPE;
  live_slug text;
  queued integer;
BEGIN
  SELECT * INTO campaign FROM public.weather_campaigns AS candidate
  WHERE candidate.id = target_campaign_id
  FOR UPDATE;
  IF campaign.id IS NULL OR campaign.status <> 'draft' THEN
    RAISE EXCEPTION 'campaign is not a draft' USING ERRCODE = '22023';
  END IF;

  SELECT page.slug INTO live_slug FROM public.booking_pages AS page
  WHERE page.tenant_id = campaign.tenant_id
    AND public.live_booking_tenant(page.slug) IS NOT NULL;
  IF live_slug IS NULL AND position('{{booking_link}}' IN campaign.body) > 0 THEN
    RAISE EXCEPTION 'booking page is off; remove the booking link or turn the page on'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.campaign_messages (
    tenant_id, campaign_id, customer_id, to_email, subject, body, booking_path
  )
  SELECT campaign.tenant_id, campaign.id, audience.customer_id, audience.email,
    campaign.subject,
    replace(campaign.body, '{{first_name}}', audience.first_name),
    CASE WHEN live_slug IS NOT NULL THEN '/book/' || live_slug END
  FROM public.weather_campaign_audience(campaign.tenant_id) AS audience
  ON CONFLICT (campaign_id, customer_id) DO NOTHING;
  GET DIAGNOSTICS queued = ROW_COUNT;

  UPDATE public.weather_campaigns
  SET status = 'sent', approved_at = now(), approved_by_user_id = target_actor,
      queued_count = queued
  WHERE id = campaign.id;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    campaign.tenant_id, target_actor, 'weather_campaign.sent', 'tenant', campaign.tenant_id,
    jsonb_build_object('campaign_id', campaign.id, 'queued', queued)
  );

  RETURN queued;
END;
$$;

REVOKE ALL ON FUNCTION public.queue_weather_campaign(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Owner RPCs
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.save_weather_campaign_settings(
  target_tenant_id uuid,
  target_enabled boolean,
  target_heat_threshold_f integer,
  target_cold_threshold_f integer,
  target_auto_send boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.current_user_has_tenant_role(
    target_tenant_id, ARRAY['owner']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'owner role required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.weather_campaign_settings (
    tenant_id, enabled, heat_threshold_f, cold_threshold_f, auto_send
  ) VALUES (
    target_tenant_id, coalesce(target_enabled, false), target_heat_threshold_f,
    target_cold_threshold_f, coalesce(target_auto_send, false)
  )
  ON CONFLICT (tenant_id) DO UPDATE
  SET enabled = EXCLUDED.enabled,
      heat_threshold_f = EXCLUDED.heat_threshold_f,
      cold_threshold_f = EXCLUDED.cold_threshold_f,
      auto_send = EXCLUDED.auto_send;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    target_tenant_id, auth.uid(), 'weather_campaign_settings.saved', 'tenant', target_tenant_id,
    jsonb_build_object(
      'enabled', coalesce(target_enabled, false),
      'heat_threshold_f', target_heat_threshold_f,
      'cold_threshold_f', target_cold_threshold_f,
      'auto_send', coalesce(target_auto_send, false)
    )
  );
END;
$$;

CREATE FUNCTION public.create_manual_weather_campaign(
  target_tenant_id uuid,
  target_kind text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  campaign uuid;
BEGIN
  IF NOT public.current_user_has_tenant_role(
    target_tenant_id, ARRAY['owner']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'owner role required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_subscriptions AS subscription
    WHERE subscription.tenant_id = target_tenant_id
      AND subscription.access_mode IN ('full', 'grace')
  ) THEN
    RAISE EXCEPTION 'subscription is read-only' USING ERRCODE = '42501';
  END IF;

  campaign := public.draft_weather_campaign(target_tenant_id, target_kind, 'manual', NULL, NULL);
  IF campaign IS NULL THEN
    RAISE EXCEPTION 'no eligible customers or a recent campaign exists'
      USING ERRCODE = '22023';
  END IF;
  RETURN campaign;
END;
$$;

CREATE FUNCTION public.send_weather_campaign(
  target_campaign_id uuid,
  target_subject text,
  target_body text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  campaign_tenant uuid;
BEGIN
  SELECT campaign.tenant_id INTO campaign_tenant
  FROM public.weather_campaigns AS campaign WHERE campaign.id = target_campaign_id;
  IF campaign_tenant IS NULL OR NOT public.current_user_has_tenant_role(
    campaign_tenant, ARRAY['owner']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'campaign not found' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_subscriptions AS subscription
    WHERE subscription.tenant_id = campaign_tenant
      AND subscription.access_mode IN ('full', 'grace')
  ) THEN
    RAISE EXCEPTION 'subscription is read-only' USING ERRCODE = '42501';
  END IF;
  IF position('{{first_name}}' IN coalesce(target_body, '')) = 0
    AND char_length(trim(coalesce(target_body, ''))) < 20 THEN
    RAISE EXCEPTION 'message is too short' USING ERRCODE = '22023';
  END IF;

  UPDATE public.weather_campaigns
  SET subject = left(trim(target_subject), 150),
      body = left(trim(target_body), 2000)
  WHERE id = target_campaign_id AND status = 'draft';

  RETURN public.queue_weather_campaign(target_campaign_id, auth.uid());
END;
$$;

CREATE FUNCTION public.cancel_weather_campaign(target_campaign_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  campaign_tenant uuid;
BEGIN
  SELECT campaign.tenant_id INTO campaign_tenant
  FROM public.weather_campaigns AS campaign WHERE campaign.id = target_campaign_id;
  IF campaign_tenant IS NULL OR NOT public.current_user_has_tenant_role(
    campaign_tenant, ARRAY['owner']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'campaign not found' USING ERRCODE = '42501';
  END IF;

  UPDATE public.weather_campaigns
  SET status = 'cancelled', cancelled_at = now()
  WHERE id = target_campaign_id AND status = 'draft';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'only drafts can be cancelled' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    campaign_tenant, auth.uid(), 'weather_campaign.cancelled', 'tenant', campaign_tenant,
    jsonb_build_object('campaign_id', target_campaign_id)
  );
  RETURN 'cancelled';
END;
$$;

-- Delivery numbers for the campaigns page.
CREATE FUNCTION public.get_weather_campaign_stats(target_tenant_id uuid)
RETURNS TABLE (campaign_id uuid, delivered integer, failed integer, waiting integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.current_user_has_tenant_role(
    target_tenant_id, ARRAY['owner']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'owner role required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT message.campaign_id,
    count(*) FILTER (WHERE message.status = 'delivered')::integer,
    count(*) FILTER (WHERE message.status IN ('failed', 'cancelled'))::integer,
    count(*) FILTER (WHERE message.status IN ('ready', 'processing'))::integer
  FROM public.campaign_messages AS message
  WHERE message.tenant_id = target_tenant_id
  GROUP BY message.campaign_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Service RPCs: forecast check and delivery
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.list_weather_campaign_tenants()
RETURNS TABLE (
  tenant_id uuid,
  street_address text,
  city text,
  state_code text,
  postal_code text,
  latitude numeric,
  longitude numeric,
  heat_threshold_f integer,
  cold_threshold_f integer,
  time_zone text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT tenant.id, tenant.street_address, tenant.city, tenant.state_code,
    tenant.postal_code, location.latitude, location.longitude,
    setting.heat_threshold_f, setting.cold_threshold_f, tenant.time_zone
  FROM public.weather_campaign_settings AS setting
  JOIN public.tenants AS tenant ON tenant.id = setting.tenant_id
  JOIN public.tenant_subscriptions AS subscription ON subscription.tenant_id = tenant.id
  LEFT JOIN public.weather_campaign_locations AS location ON location.tenant_id = tenant.id
  WHERE setting.enabled
    AND subscription.access_mode IN ('full', 'grace')
    AND nullif(btrim(tenant.postal_code), '') IS NOT NULL;
END;
$$;

CREATE TABLE public.weather_campaign_locations (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE RESTRICT,
  latitude numeric(9, 6) NOT NULL,
  longitude numeric(9, 6) NOT NULL,
  address_hash text NOT NULL,
  geocoded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weather_campaign_locations_range CHECK (
    latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
  )
);

ALTER TABLE public.weather_campaign_locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.weather_campaign_locations FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.record_weather_campaign_location(
  target_tenant_id uuid,
  target_latitude numeric,
  target_longitude numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.weather_campaign_locations (
    tenant_id, latitude, longitude, address_hash
  )
  SELECT tenant.id, target_latitude, target_longitude,
    public.customer_address_hash(tenant.street_address, tenant.city,
      tenant.state_code, tenant.postal_code)
  FROM public.tenants AS tenant WHERE tenant.id = target_tenant_id
  ON CONFLICT (tenant_id) DO UPDATE
  SET latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      address_hash = EXCLUDED.address_hash,
      geocoded_at = now();
END;
$$;

CREATE FUNCTION public.record_weather_campaign_forecast(
  target_tenant_id uuid,
  target_kind text,
  target_forecast_date date,
  target_forecast_temp_f integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.weather_campaign_settings AS setting
    JOIN public.tenant_subscriptions AS subscription
      ON subscription.tenant_id = setting.tenant_id
    WHERE setting.tenant_id = target_tenant_id
      AND setting.enabled
      AND subscription.access_mode IN ('full', 'grace')
  ) THEN
    RETURN NULL;
  END IF;
  RETURN public.draft_weather_campaign(
    target_tenant_id, target_kind, 'forecast', target_forecast_date, target_forecast_temp_f
  );
END;
$$;

CREATE FUNCTION public.claim_campaign_email_deliveries(target_batch_size integer DEFAULT 10)
RETURNS TABLE (
  message_id uuid,
  lease_token uuid,
  to_email text,
  subject text,
  body text,
  booking_path text,
  sender_name text,
  reply_to_email text,
  unsubscribe_token text,
  postal_address text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF target_batch_size NOT BETWEEN 1 AND 25 THEN
    RAISE EXCEPTION 'email delivery batch size is invalid' USING ERRCODE = '22023';
  END IF;

  UPDATE public.campaign_messages AS message
  SET status = 'failed', lease_token = NULL, lease_expires_at = NULL,
      next_attempt_at = NULL, last_error_code = 'delivery_lease_expired'
  WHERE message.status = 'processing'
    AND message.lease_expires_at < now()
    AND message.attempt_count >= 5;

  -- Consent is rechecked right before every send.
  UPDATE public.campaign_messages AS message
  SET status = 'cancelled', lease_token = NULL, lease_expires_at = NULL,
      next_attempt_at = NULL, last_error_code = 'consent_changed'
  FROM public.customers AS customer
  WHERE customer.id = message.customer_id
    AND customer.tenant_id = message.tenant_id
    AND (
      message.status = 'ready'
      OR (message.status = 'processing' AND message.lease_expires_at < now())
    )
    AND (
      customer.archived_at IS NOT NULL
      OR customer.email_suppressed_at IS NOT NULL
      OR NOT customer.marketing_email_opted_in
      OR lower(customer.email) IS DISTINCT FROM message.to_email
    );

  RETURN QUERY
  WITH candidates AS (
    SELECT message.id
    FROM public.campaign_messages AS message
    JOIN public.tenants AS tenant ON tenant.id = message.tenant_id
    WHERE message.attempt_count < 5
      AND (
        (message.status = 'ready' AND message.next_attempt_at <= now())
        OR (message.status = 'processing' AND message.lease_expires_at < now())
      )
      AND nullif(btrim(tenant.street_address), '') IS NOT NULL
      AND nullif(btrim(tenant.city), '') IS NOT NULL
      AND nullif(btrim(tenant.state_code), '') IS NOT NULL
      AND nullif(btrim(tenant.postal_code), '') IS NOT NULL
      AND public.marketing_unsubscribe_signature(message.customer_id) IS NOT NULL
    ORDER BY message.next_attempt_at NULLS FIRST, message.id
    FOR UPDATE OF message SKIP LOCKED
    LIMIT target_batch_size
  ), claimed AS (
    UPDATE public.campaign_messages AS message
    SET status = 'processing',
        attempt_count = message.attempt_count + 1,
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + interval '2 minutes',
        last_error_code = NULL
    FROM candidates
    WHERE message.id = candidates.id
    RETURNING message.id, message.tenant_id, message.customer_id,
      message.lease_token, message.to_email, message.subject, message.body,
      message.booking_path
  )
  SELECT claimed.id, claimed.lease_token, claimed.to_email, claimed.subject,
    claimed.body, claimed.booking_path, tenant.display_name, tenant.business_email,
    claimed.customer_id::text || '.'
      || public.marketing_unsubscribe_signature(claimed.customer_id),
    concat_ws(', ', btrim(tenant.street_address), btrim(tenant.city),
      btrim(tenant.state_code) || ' ' || btrim(tenant.postal_code),
      tenant.country_code)
  FROM claimed
  JOIN public.tenants AS tenant ON tenant.id = claimed.tenant_id;
END;
$$;

CREATE FUNCTION public.complete_campaign_email_delivery(
  target_message_id uuid,
  target_lease_token uuid,
  target_provider_message_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.campaign_messages
  SET status = 'delivered', delivered_at = now(), lease_token = NULL,
      lease_expires_at = NULL, next_attempt_at = NULL,
      provider_message_id = left(target_provider_message_id, 200)
  WHERE id = target_message_id
    AND status = 'processing'
    AND lease_token = target_lease_token;
  RETURN FOUND;
END;
$$;

CREATE FUNCTION public.retry_campaign_email_delivery(
  target_message_id uuid,
  target_lease_token uuid,
  target_error_code text,
  target_permanent boolean
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  next_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.campaign_messages AS message
  SET status = CASE WHEN target_permanent OR message.attempt_count >= 5
        THEN 'failed' ELSE 'ready' END,
      next_attempt_at = CASE WHEN target_permanent OR message.attempt_count >= 5
        THEN NULL ELSE now() + make_interval(mins => 5 * message.attempt_count) END,
      lease_token = NULL,
      lease_expires_at = NULL,
      last_error_code = left(coalesce(target_error_code, 'send_failed'), 80)
  WHERE message.id = target_message_id
    AND message.status = 'processing'
    AND message.lease_token = target_lease_token
  RETURNING message.status INTO next_status;
  RETURN next_status;
END;
$$;

-- ---------------------------------------------------------------------------
-- Owner email kind wiring
-- ---------------------------------------------------------------------------

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
          'weather_risk_alert', 'booking_request_owner',
          'booking_request_customer', 'weather_campaign_ready'
        )
        AND position('{{link}}' IN body) = 0
      )
      OR (
        kind NOT IN (
          'job_scheduled', 'job_rescheduled', 'job_cancelled',
          'owner_daily_summary', 'owner_weekly_summary', 'quote_reminder',
          'weather_risk_alert', 'booking_request_owner',
          'booking_request_customer', 'weather_campaign_ready'
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
          'weather_risk_alert', 'booking_request_owner',
          'booking_request_customer', 'weather_campaign_ready'
        )
      AND link_path IS NULL
    )
    OR (
      kind NOT IN (
          'job_scheduled', 'job_rescheduled', 'job_cancelled',
          'owner_daily_summary', 'owner_weekly_summary', 'quote_reminder',
          'weather_risk_alert', 'booking_request_owner',
          'booking_request_customer', 'weather_campaign_ready'
        )
      AND (
        (status IN ('ready', 'processing') AND link_path IS NOT NULL)
        OR (status IN ('delivered', 'failed', 'cancelled') AND link_path IS NULL)
      )
    )
  );

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
    WHEN 'booking_request_owner' THEN public.booking_owner_email_is_current(
      target_tenant_id, target_email
    )
    WHEN 'booking_request_customer' THEN public.booking_customer_email_is_current(
      target_entity_id, target_tenant_id, target_email
    )
    WHEN 'weather_campaign_ready' THEN public.weather_campaign_owner_email_is_current(
      target_tenant_id, target_email
    )
    ELSE false
  END;
$$;

-- ---------------------------------------------------------------------------
-- Grants and schedules
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.weather_campaign_email_hash(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.weather_campaign_owner_email_is_current(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_weather_campaign_settings(uuid, boolean, integer, integer, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_manual_weather_campaign(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.send_weather_campaign(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_weather_campaign(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_weather_campaign_stats(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_weather_campaign_tenants() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_weather_campaign_location(uuid, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_weather_campaign_forecast(uuid, text, date, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_campaign_email_deliveries(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_campaign_email_delivery(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_campaign_email_delivery(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.save_weather_campaign_settings(uuid, boolean, integer, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_manual_weather_campaign(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_weather_campaign(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_weather_campaign(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_weather_campaign_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_weather_campaign_tenants() TO service_role;
GRANT EXECUTE ON FUNCTION public.record_weather_campaign_location(uuid, numeric, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_weather_campaign_forecast(uuid, text, date, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_campaign_email_deliveries(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_campaign_email_delivery(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_campaign_email_delivery(uuid, uuid, text, boolean) TO service_role;

-- Run once after deploying the two edge functions (needs the shared Vault
-- secrets used by the other CrewFlow crons).
CREATE FUNCTION public.configure_weather_campaign_crons()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  existing_job_id bigint;
  job_name text;
BEGIN
  IF session_user <> 'postgres'
    AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'crewflow_project_url')
    OR NOT EXISTS (
      SELECT 1 FROM vault.secrets WHERE name = 'crewflow_edge_function_service_key'
    ) THEN
    RAISE EXCEPTION 'shared CrewFlow cron secrets are not configured'
      USING ERRCODE = '55000';
  END IF;

  FOREACH job_name IN ARRAY ARRAY[
    'crewflow-weather-campaign-check', 'crewflow-campaign-emails'
  ] LOOP
    SELECT jobid INTO existing_job_id FROM cron.job WHERE jobname = job_name LIMIT 1;
    IF existing_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(existing_job_id);
    END IF;
  END LOOP;

  PERFORM cron.schedule(
    'crewflow-weather-campaign-check',
    '10 13 * * *',
    $command$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'crewflow_project_url') || '/functions/v1/weather-campaign-check',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'crewflow_edge_function_service_key')
        ),
        body := jsonb_build_object('scheduled_at', now()),
        timeout_milliseconds := 60000
      ) AS request_id;
    $command$
  );
  PERFORM cron.schedule(
    'crewflow-campaign-emails',
    '*/5 * * * *',
    $command$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'crewflow_project_url') || '/functions/v1/process-campaign-emails',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'crewflow_edge_function_service_key')
        ),
        body := jsonb_build_object('scheduled_at', now()),
        timeout_milliseconds := 60000
      ) AS request_id;
    $command$
  );
  RETURN 2;
END;
$$;

REVOKE ALL ON FUNCTION public.configure_weather_campaign_crons() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_weather_campaign_crons() TO service_role;
