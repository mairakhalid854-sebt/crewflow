-- Online booking page (Batch 1, feature 1).
--
-- A business can publish a booking page at /book/<slug>. A visitor picks an
-- enabled service, sees real open times (skills, service area, working hours,
-- time off, and existing work are respected), and sends a request. The
-- request creates a customer and an unscheduled "new" job, and holds the
-- chosen time for up to 48 hours so no one else can take it. The office then
-- applies the requested time with one click, or dismisses it.
--
-- Everything is off by default: no booking page exists until an owner
-- creates one, and each service must be opted in.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

ALTER TABLE public.services
  ADD COLUMN online_booking_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.services.online_booking_enabled IS
  'Shown on the public booking page when the page is enabled.';

CREATE TABLE public.booking_pages (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE RESTRICT,
  slug text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  headline text,
  intro text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_pages_slug_unique UNIQUE (slug),
  CONSTRAINT booking_pages_slug_format CHECK (
    slug ~ '^[a-z0-9]([a-z0-9-]{1,46})[a-z0-9]$' AND position('--' IN slug) = 0
  ),
  CONSTRAINT booking_pages_slug_not_reserved CHECK (
    slug NOT IN (
      'app', 'admin', 'api', 'book', 'booking', 'crewflow', 'crewflow360',
      'help', 'login', 'pricing', 'privacy', 'signup', 'support', 'terms', 'www'
    )
  ),
  CONSTRAINT booking_pages_headline_length CHECK (
    headline IS NULL OR char_length(headline) BETWEEN 1 AND 120
  ),
  CONSTRAINT booking_pages_intro_length CHECK (
    intro IS NULL OR char_length(intro) BETWEEN 1 AND 600
  )
);

CREATE TABLE public.booking_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  service_id uuid NOT NULL,
  requested_start_at timestamptz NOT NULL,
  requested_end_at timestamptz NOT NULL,
  suggested_membership_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  hold_expires_at timestamptz NOT NULL,
  contact_key text NOT NULL,
  customer_note text,
  referral_code text,
  decided_at timestamptz,
  decided_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_requests_job_unique UNIQUE (job_id),
  CONSTRAINT booking_requests_job_fk FOREIGN KEY (job_id, tenant_id)
    REFERENCES public.jobs(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT booking_requests_customer_fk FOREIGN KEY (customer_id, tenant_id)
    REFERENCES public.customers(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT booking_requests_service_fk FOREIGN KEY (service_id, tenant_id)
    REFERENCES public.services(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT booking_requests_technician_fk
    FOREIGN KEY (suggested_membership_id, tenant_id)
    REFERENCES public.memberships(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT booking_requests_window CHECK (requested_start_at < requested_end_at),
  CONSTRAINT booking_requests_status CHECK (
    status IN ('pending', 'applied', 'dismissed')
  ),
  CONSTRAINT booking_requests_decision_shape CHECK (
    (status = 'pending' AND decided_at IS NULL)
    OR (status <> 'pending' AND decided_at IS NOT NULL)
  ),
  CONSTRAINT booking_requests_contact_key_format CHECK (
    contact_key ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT booking_requests_note_length CHECK (
    customer_note IS NULL OR char_length(customer_note) <= 1000
  ),
  CONSTRAINT booking_requests_referral_code_format CHECK (
    referral_code IS NULL OR referral_code ~ '^[A-Z0-9]{8}$'
  )
);

CREATE INDEX booking_requests_tenant_status_idx
  ON public.booking_requests (tenant_id, status, created_at DESC);
CREATE INDEX booking_requests_hold_idx
  ON public.booking_requests (tenant_id, suggested_membership_id, requested_start_at)
  WHERE status = 'pending';
CREATE INDEX booking_requests_contact_idx
  ON public.booking_requests (tenant_id, contact_key, created_at DESC);

CREATE TRIGGER booking_pages_updated_at
BEFORE UPDATE ON public.booking_pages
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER booking_pages_require_write_entitlement
BEFORE INSERT OR UPDATE OR DELETE ON public.booking_pages
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_write_entitlement();

ALTER TABLE public.booking_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_pages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.booking_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.booking_pages TO authenticated;
GRANT SELECT ON public.booking_requests TO authenticated;

CREATE POLICY booking_pages_select ON public.booking_pages
  FOR SELECT TO authenticated
  USING (
    public.current_user_has_tenant_role(
      tenant_id, ARRAY['owner', 'office']::public.membership_role[]
    )
  );

CREATE POLICY booking_requests_select ON public.booking_requests
  FOR SELECT TO authenticated
  USING (
    public.current_user_has_tenant_role(
      tenant_id, ARRAY['owner', 'office']::public.membership_role[]
    )
  );

-- ---------------------------------------------------------------------------
-- Open slots (internal)
-- ---------------------------------------------------------------------------

-- Open times for one service in one ZIP code over the next target_days days.
-- A technician is busy when any live job (not cancelled, completed, or
-- closed) is assigned with overlapping times, or when a pending booking
-- request still holds the time.
CREATE FUNCTION public.booking_open_slots(
  target_tenant_id uuid,
  target_service_id uuid,
  target_postal_code text,
  target_days integer DEFAULT 14,
  target_limit integer DEFAULT 200
)
RETURNS TABLE (
  starts_at timestamptz,
  ends_at timestamptz,
  technician_membership_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  zone text;
  duration_minutes integer;
  needed_skills text[];
  local_today date;
  zip5 text := left(coalesce(target_postal_code, ''), 5);
BEGIN
  SELECT tenant.time_zone INTO zone
  FROM public.tenants AS tenant WHERE tenant.id = target_tenant_id;

  SELECT service.default_duration_minutes, coalesce(service.required_skills, '{}')
  INTO duration_minutes, needed_skills
  FROM public.services AS service
  WHERE service.id = target_service_id
    AND service.tenant_id = target_tenant_id
    AND service.archived_at IS NULL
    AND service.is_enabled;

  IF zone IS NULL OR duration_minutes IS NULL OR zip5 !~ '^\d{5}$' THEN
    RETURN;
  END IF;

  local_today := (now() AT TIME ZONE zone)::date;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      membership.id AS technician_id,
      (((local_today + day_offset.value) + availability.starts_at
        + make_interval(hours => step.value)) AT TIME ZONE zone) AS slot_start
    FROM generate_series(0, greatest(1, least(coalesce(target_days, 14), 28)) - 1)
      AS day_offset(value)
    JOIN public.memberships AS membership
      ON membership.tenant_id = target_tenant_id
     AND membership.role = 'technician'
     AND membership.status = 'active'
    JOIN public.staff_profiles AS profile
      ON profile.membership_id = membership.id
     AND profile.tenant_id = membership.tenant_id
    JOIN public.staff_availability AS availability
      ON availability.membership_id = membership.id
     AND availability.tenant_id = membership.tenant_id
     AND availability.is_available
     AND availability.starts_at IS NOT NULL
     AND availability.ends_at IS NOT NULL
     AND availability.day_of_week = extract(dow FROM local_today + day_offset.value)::smallint
    CROSS JOIN LATERAL generate_series(
      0,
      floor(
        (extract(epoch FROM availability.ends_at - availability.starts_at) / 60
          - duration_minutes) / 60
      )::integer
    ) AS step(value)
    WHERE extract(epoch FROM availability.ends_at - availability.starts_at) / 60 >= duration_minutes
      AND (
        cardinality(profile.service_area_postal_codes) = 0
        OR zip5 = ANY (profile.service_area_postal_codes)
      )
      AND NOT EXISTS (
        SELECT 1 FROM unnest(needed_skills) AS required_skill
        WHERE NOT EXISTS (
          SELECT 1 FROM unnest(profile.skills) AS staff_skill
          WHERE lower(trim(staff_skill)) = lower(trim(required_skill))
        )
      )
  )
  SELECT
    candidate.slot_start,
    candidate.slot_start + make_interval(mins => duration_minutes),
    candidate.technician_id
  FROM candidates AS candidate
  WHERE candidate.slot_start > now() + interval '2 hours'
    AND NOT EXISTS (
      SELECT 1 FROM public.staff_time_off AS time_off
      WHERE time_off.tenant_id = target_tenant_id
        AND time_off.membership_id = candidate.technician_id
        AND time_off.cancelled_at IS NULL
        AND time_off.starts_at < candidate.slot_start + make_interval(mins => duration_minutes)
        AND time_off.ends_at > candidate.slot_start
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.jobs AS other
      WHERE other.tenant_id = target_tenant_id
        AND other.assigned_membership_id = candidate.technician_id
        AND other.archived_at IS NULL
        AND other.status NOT IN ('cancelled', 'completed', 'closed')
        AND other.scheduled_start_at < candidate.slot_start + make_interval(mins => duration_minutes)
        AND other.scheduled_end_at > candidate.slot_start
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.booking_requests AS hold
      WHERE hold.tenant_id = target_tenant_id
        AND hold.status = 'pending'
        AND hold.hold_expires_at > now()
        AND hold.suggested_membership_id = candidate.technician_id
        AND hold.requested_start_at < candidate.slot_start + make_interval(mins => duration_minutes)
        AND hold.requested_end_at > candidate.slot_start
    )
  ORDER BY candidate.slot_start, candidate.technician_id
  LIMIT greatest(1, least(coalesce(target_limit, 200), 1000));
END;
$$;

REVOKE ALL ON FUNCTION public.booking_open_slots(uuid, uuid, text, integer, integer)
  FROM PUBLIC, anon, authenticated;

-- The tenant behind a live booking page, or NULL. A page is live when it is
-- enabled and the workspace can still accept new records.
CREATE FUNCTION public.live_booking_tenant(target_slug text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT page.tenant_id
  FROM public.booking_pages AS page
  JOIN public.tenant_subscriptions AS subscription
    ON subscription.tenant_id = page.tenant_id
  WHERE page.slug = lower(trim(target_slug))
    AND page.enabled
    AND subscription.access_mode IN ('full', 'grace');
$$;

REVOKE ALL ON FUNCTION public.live_booking_tenant(text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public RPCs (anon)
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.get_public_booking_page(target_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  page_tenant uuid := public.live_booking_tenant(target_slug);
  result jsonb;
BEGIN
  IF page_tenant IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'slug', page.slug,
    'business_name', tenant.display_name,
    'business_phone', tenant.phone,
    'city', tenant.city,
    'state_code', tenant.state_code,
    'time_zone', tenant.time_zone,
    'headline', page.headline,
    'intro', page.intro,
    'services', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', service.id,
        'name', service.name,
        'description', service.description,
        'price_cents', service.unit_price_cents,
        'duration_minutes', service.default_duration_minutes
      ) ORDER BY service.name)
      FROM public.services AS service
      WHERE service.tenant_id = page.tenant_id
        AND service.online_booking_enabled
        AND service.is_enabled
        AND service.archived_at IS NULL
    ), '[]'::jsonb)
  )
  INTO result
  FROM public.booking_pages AS page
  JOIN public.tenants AS tenant ON tenant.id = page.tenant_id
  WHERE page.tenant_id = page_tenant;

  RETURN result;
END;
$$;

-- Distinct open start times (no technician details) for the public page.
CREATE FUNCTION public.get_public_booking_slots(
  target_slug text,
  target_service_id uuid,
  target_postal_code text
)
RETURNS TABLE (starts_at timestamptz, ends_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  page_tenant uuid := public.live_booking_tenant(target_slug);
BEGIN
  IF page_tenant IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.services AS service
    WHERE service.id = target_service_id
      AND service.tenant_id = page_tenant
      AND service.online_booking_enabled
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (slot.starts_at) slot.starts_at, slot.ends_at
  FROM public.booking_open_slots(
    page_tenant, target_service_id, target_postal_code, 14, 1000
  ) AS slot
  ORDER BY slot.starts_at
  LIMIT 60;
END;
$$;

CREATE FUNCTION public.booking_contact_key(
  target_tenant_id uuid,
  target_email text,
  target_phone text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        concat_ws('|', 'booking', target_tenant_id::text,
          coalesce(nullif(lower(trim(target_email)), ''),
            regexp_replace(coalesce(target_phone, ''), '\D', '', 'g'))),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

REVOKE ALL ON FUNCTION public.booking_contact_key(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Emails
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.booking_owner_email_is_current(
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
    FROM public.memberships AS membership
    JOIN auth.users AS account ON account.id = membership.user_id
    WHERE membership.tenant_id = target_tenant_id
      AND membership.role = 'owner'
      AND membership.status = 'active'
      AND lower(account.email) = target_email
  );
$$;

CREATE FUNCTION public.booking_customer_email_is_current(
  target_request_id uuid,
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
    FROM public.booking_requests AS request
    JOIN public.customers AS customer
      ON customer.id = request.customer_id AND customer.tenant_id = request.tenant_id
    WHERE request.id = target_request_id
      AND request.tenant_id = target_tenant_id
      AND request.status <> 'dismissed'
      AND customer.archived_at IS NULL
      AND customer.email_suppressed_at IS NULL
      AND customer.transactional_email_allowed
      AND lower(customer.email) = target_email
  );
$$;

CREATE FUNCTION public.booking_email_hash(
  target_kind text,
  target_request_id uuid,
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
        concat_ws('|', target_kind, target_request_id::text, lower(target_email)),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

-- Queues the "new booking" email to each active owner and a "request
-- received" email to the customer (when an email address was given).
CREATE FUNCTION public.queue_booking_request_emails(target_request_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request public.booking_requests%ROWTYPE;
  zone text;
  business_name text;
  business_phone text;
  service_name text;
  customer_name text;
  customer_first text;
  customer_email text;
  customer_phone text;
  customer_language text;
  street text;
  zip text;
  when_label text;
  recipient record;
  inserted integer;
  queued integer := 0;
BEGIN
  SELECT * INTO request FROM public.booking_requests AS candidate
  WHERE candidate.id = target_request_id;
  IF request.id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT tenant.time_zone, tenant.display_name, tenant.phone
  INTO zone, business_name, business_phone
  FROM public.tenants AS tenant WHERE tenant.id = request.tenant_id;
  SELECT service.name INTO service_name
  FROM public.services AS service WHERE service.id = request.service_id;
  SELECT customer.first_name || ' ' || customer.last_name, customer.first_name,
    lower(customer.email), customer.phone, customer.preferred_language,
    customer.street_address, customer.postal_code
  INTO customer_name, customer_first, customer_email, customer_phone,
    customer_language, street, zip
  FROM public.customers AS customer WHERE customer.id = request.customer_id;

  when_label := to_char(request.requested_start_at AT TIME ZONE zone,
    'FMDay, FMMonth FMDD "at" FMHH12:MI AM');

  FOR recipient IN
    SELECT DISTINCT lower(account.email) AS email
    FROM public.memberships AS membership
    JOIN auth.users AS account ON account.id = membership.user_id
    WHERE membership.tenant_id = request.tenant_id
      AND membership.role = 'owner'
      AND membership.status = 'active'
      AND account.email IS NOT NULL
  LOOP
    INSERT INTO public.transactional_emails (
      tenant_id, kind, entity_id, token_hash, to_email, subject, body,
      link_path, status, requested_by_user_id
    ) VALUES (
      request.tenant_id, 'booking_request_owner', request.id,
      public.booking_email_hash('booking_request_owner', request.id, recipient.email),
      recipient.email,
      left(format('New online booking: %s, %s', service_name, when_label), 240),
      left(array_to_string(ARRAY[
        format('%s booked %s online for %s.', customer_name, service_name, when_label),
        '',
        'Customer: ' || customer_name,
        'Email: ' || coalesce(customer_email, 'not given'),
        'Phone: ' || coalesce(customer_phone, 'not given'),
        'Address: ' || coalesce(street, '') || ', ' || coalesce(zip, ''),
        CASE WHEN request.customer_note IS NOT NULL
          THEN 'Note: ' || request.customer_note ELSE '' END,
        '',
        'The time is held for you until '
          || to_char(request.hold_expires_at AT TIME ZONE zone,
            'FMMonth FMDD "at" FMHH12:MI AM')
          || '. Open the job in CrewFlow360 and choose "Apply requested time" to schedule it, or dismiss the request.'
      ], E'\n'), 4000),
      NULL, 'ready', NULL
    )
    ON CONFLICT (tenant_id, kind, token_hash) DO NOTHING;
    GET DIAGNOSTICS inserted = ROW_COUNT;
    queued := queued + inserted;
  END LOOP;

  IF customer_email IS NOT NULL
    AND public.booking_customer_email_is_current(
      request.id, request.tenant_id, customer_email
    )
  THEN
    INSERT INTO public.transactional_emails (
      tenant_id, kind, entity_id, token_hash, to_email, subject, body,
      link_path, status, requested_by_user_id
    ) VALUES (
      request.tenant_id, 'booking_request_customer', request.id,
      public.booking_email_hash('booking_request_customer', request.id, customer_email),
      customer_email,
      left(CASE WHEN customer_language = 'es'
        THEN format('Recibimos su solicitud: %s', business_name)
        ELSE format('We received your request: %s', business_name) END, 240),
      left(CASE WHEN customer_language = 'es' THEN array_to_string(ARRAY[
          format('Hola %s,', customer_first),
          '',
          format('Gracias por reservar %s con %s para el %s.', service_name,
            business_name, when_label),
          'Su solicitud está pendiente. El negocio la confirmará pronto.',
          CASE WHEN business_phone IS NOT NULL
            THEN 'Si necesita cambiarla, llame al ' || business_phone || '.' ELSE '' END
        ], E'\n')
        ELSE array_to_string(ARRAY[
          format('Hi %s,', customer_first),
          '',
          format('Thanks for booking %s with %s for %s.', service_name,
            business_name, when_label),
          'Your request is pending. The business will confirm it soon.',
          CASE WHEN business_phone IS NOT NULL
            THEN 'Need to change it? Call ' || business_phone || '.' ELSE '' END
        ], E'\n') END, 4000),
      NULL, 'ready', NULL
    )
    ON CONFLICT (tenant_id, kind, token_hash) DO NOTHING;
    GET DIAGNOSTICS inserted = ROW_COUNT;
    queued := queued + inserted;
  END IF;

  RETURN queued;
END;
$$;

REVOKE ALL ON FUNCTION public.queue_booking_request_emails(uuid)
  FROM PUBLIC, anon, authenticated;

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
          'booking_request_customer'
        )
        AND position('{{link}}' IN body) = 0
      )
      OR (
        kind NOT IN (
          'job_scheduled', 'job_rescheduled', 'job_cancelled',
          'owner_daily_summary', 'owner_weekly_summary', 'quote_reminder',
          'weather_risk_alert', 'booking_request_owner',
          'booking_request_customer'
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
          'booking_request_customer'
      )
      AND link_path IS NULL
    )
    OR (
      kind NOT IN (
        'job_scheduled', 'job_rescheduled', 'job_cancelled',
          'owner_daily_summary', 'owner_weekly_summary', 'quote_reminder',
          'weather_risk_alert', 'booking_request_owner',
          'booking_request_customer'
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
    ELSE false
  END;
$$;

-- ---------------------------------------------------------------------------
-- Public booking submission (anon)
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.submit_public_booking(
  target_slug text,
  target_service_id uuid,
  target_starts_at timestamptz,
  target_first_name text,
  target_last_name text,
  target_email text,
  target_phone text,
  target_street_address text,
  target_postal_code text,
  target_note text DEFAULT NULL,
  target_language text DEFAULT 'en',
  target_marketing_opt_in boolean DEFAULT false,
  target_website text DEFAULT NULL,
  target_referral_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  page_tenant uuid := public.live_booking_tenant(target_slug);
  service public.services%ROWTYPE;
  zone text;
  business_name text;
  clean_first text := left(trim(coalesce(target_first_name, '')), 80);
  clean_last text := left(trim(coalesce(target_last_name, '')), 80);
  clean_email text := nullif(lower(trim(coalesce(target_email, ''))), '');
  phone_digits text := regexp_replace(coalesce(target_phone, ''), '\D', '', 'g');
  clean_phone text;
  clean_street text := nullif(left(trim(coalesce(target_street_address, '')), 200), '');
  clean_zip text := trim(coalesce(target_postal_code, ''));
  clean_note text := nullif(left(trim(coalesce(target_note, '')), 1000), '');
  clean_language text := CASE WHEN target_language = 'es' THEN 'es' ELSE 'en' END;
  contact_hash text;
  clean_referral text := upper(trim(coalesce(target_referral_code, '')));
  slot_end timestamptz;
  technician uuid;
  matched_customer uuid;
  new_job uuid;
  new_request uuid;
  local_label text;
BEGIN
  -- Bots fill the hidden website field. Pretend success and store nothing.
  IF nullif(trim(coalesce(target_website, '')), '') IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'received');
  END IF;

  IF page_tenant IS NULL THEN
    RAISE EXCEPTION 'booking page unavailable' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO service FROM public.services AS candidate
  WHERE candidate.id = target_service_id
    AND candidate.tenant_id = page_tenant
    AND candidate.online_booking_enabled
    AND candidate.is_enabled
    AND candidate.archived_at IS NULL;
  IF service.id IS NULL THEN
    RAISE EXCEPTION 'service unavailable' USING ERRCODE = '22023';
  END IF;

  IF char_length(clean_first) < 1 OR char_length(clean_last) < 1 THEN
    RAISE EXCEPTION 'name required' USING ERRCODE = '22023';
  END IF;
  IF clean_email IS NOT NULL AND (
    char_length(clean_email) > 254 OR clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ) THEN
    RAISE EXCEPTION 'invalid email' USING ERRCODE = '22023';
  END IF;
  IF phone_digits ~ '^1\d{10}$' THEN
    phone_digits := substring(phone_digits FROM 2);
  END IF;
  IF phone_digits <> '' AND phone_digits !~ '^[2-9]\d{2}[2-9]\d{6}$' THEN
    RAISE EXCEPTION 'invalid phone' USING ERRCODE = '22023';
  END IF;
  IF clean_email IS NULL AND phone_digits = '' THEN
    RAISE EXCEPTION 'email or phone required' USING ERRCODE = '22023';
  END IF;
  clean_phone := CASE WHEN phone_digits = '' THEN NULL ELSE '+1' || phone_digits END;
  IF clean_street IS NULL THEN
    RAISE EXCEPTION 'address required' USING ERRCODE = '22023';
  END IF;
  IF clean_zip !~ '^\d{5}(-\d{4})?$' THEN
    RAISE EXCEPTION 'invalid zip' USING ERRCODE = '22023';
  END IF;

  -- One booking at a time per business, so two visitors cannot take the
  -- same time.
  PERFORM pg_advisory_xact_lock(hashtextextended('booking:' || page_tenant::text, 0));

  contact_hash := public.booking_contact_key(page_tenant, clean_email, phone_digits);

  IF (
    SELECT count(*) FROM public.booking_requests AS recent
    WHERE recent.tenant_id = page_tenant
      AND recent.created_at > now() - interval '1 hour'
  ) >= 20 OR (
    SELECT count(*) FROM public.booking_requests AS recent
    WHERE recent.tenant_id = page_tenant
      AND recent.contact_key = contact_hash
      AND recent.created_at > now() - interval '24 hours'
  ) >= 3 THEN
    RAISE EXCEPTION 'booking rate limited' USING ERRCODE = '54000';
  END IF;

  SELECT slot.technician_membership_id, slot.ends_at
  INTO technician, slot_end
  FROM public.booking_open_slots(page_tenant, service.id, clean_zip, 14, 1000) AS slot
  WHERE slot.starts_at = target_starts_at
  ORDER BY slot.technician_membership_id
  LIMIT 1;
  IF technician IS NULL THEN
    RAISE EXCEPTION 'time no longer available' USING ERRCODE = '40001';
  END IF;

  SELECT tenant.time_zone, tenant.display_name INTO zone, business_name
  FROM public.tenants AS tenant WHERE tenant.id = page_tenant;
  local_label := to_char(target_starts_at AT TIME ZONE zone,
    'FMDay, FMMonth FMDD "at" FMHH12:MI AM');

  IF clean_email IS NOT NULL THEN
    SELECT customer.id INTO matched_customer
    FROM public.customers AS customer
    WHERE customer.tenant_id = page_tenant
      AND customer.archived_at IS NULL
      AND lower(customer.email) = clean_email
      AND lower(customer.last_name) = lower(clean_last)
    ORDER BY customer.created_at
    LIMIT 1;
  END IF;

  IF matched_customer IS NULL THEN
    INSERT INTO public.customers (
      tenant_id, first_name, last_name, email, phone, street_address,
      postal_code, notes, transactional_email_allowed,
      marketing_email_opted_in, preferred_language
    ) VALUES (
      page_tenant, clean_first, clean_last, clean_email, clean_phone, clean_street, clean_zip,
      'Created from the online booking page.', true,
      coalesce(target_marketing_opt_in, false), clean_language
    ) RETURNING id INTO matched_customer;
  END IF;

  INSERT INTO public.jobs (
    tenant_id, customer_id, service_id, title, description, priority, status
  ) VALUES (
    page_tenant, matched_customer, service.id, left(service.name, 160),
    left(concat_ws(E'\n\n',
      'Online booking request for ' || local_label || '.',
      'Address: ' || clean_street || ', ' || clean_zip,
      CASE WHEN clean_note IS NOT NULL THEN 'Customer note: ' || clean_note END
    ), 5000),
    'normal', 'new'
  ) RETURNING id INTO new_job;

  INSERT INTO public.booking_requests (
    tenant_id, job_id, customer_id, service_id, requested_start_at,
    requested_end_at, suggested_membership_id, hold_expires_at, contact_key,
    customer_note, referral_code
  ) VALUES (
    page_tenant, new_job, matched_customer, service.id, target_starts_at,
    slot_end, technician, least(target_starts_at, now() + interval '48 hours'),
    contact_hash, clean_note,
    CASE WHEN clean_referral ~ '^[A-Z0-9]{8}$' THEN clean_referral END
  ) RETURNING id INTO new_request;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    page_tenant, NULL, 'booking.requested', 'job', new_job,
    jsonb_build_object(
      'booking_request_id', new_request,
      'service_id', service.id,
      'requested_start_at', target_starts_at,
      'source', 'booking_page'
    )
  );

  PERFORM public.queue_booking_request_emails(new_request);

  RETURN jsonb_build_object(
    'status', 'requested',
    'reference', upper(left(replace(new_request::text, '-', ''), 8)),
    'starts_at', target_starts_at,
    'ends_at', slot_end,
    'business_name', business_name,
    'service_name', service.name
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Owner and office RPCs
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.save_booking_page(
  target_tenant_id uuid,
  target_slug text,
  target_enabled boolean,
  target_headline text DEFAULT NULL,
  target_intro text DEFAULT NULL
)
RETURNS public.booking_pages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  clean_slug text := lower(trim(coalesce(target_slug, '')));
  saved public.booking_pages;
BEGIN
  IF NOT public.current_user_has_tenant_role(
    target_tenant_id, ARRAY['owner']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'owner role required' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.booking_pages AS other
    WHERE other.slug = clean_slug AND other.tenant_id <> target_tenant_id
  ) THEN
    RAISE EXCEPTION 'booking link already taken' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.booking_pages (tenant_id, slug, enabled, headline, intro)
  VALUES (
    target_tenant_id, clean_slug, coalesce(target_enabled, false),
    nullif(trim(coalesce(target_headline, '')), ''),
    nullif(trim(coalesce(target_intro, '')), '')
  )
  ON CONFLICT (tenant_id) DO UPDATE
  SET slug = EXCLUDED.slug,
      enabled = EXCLUDED.enabled,
      headline = EXCLUDED.headline,
      intro = EXCLUDED.intro
  RETURNING * INTO saved;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    target_tenant_id, auth.uid(), 'booking_page.saved', 'tenant', target_tenant_id,
    jsonb_build_object('slug', saved.slug, 'enabled', saved.enabled)
  );

  RETURN saved;
END;
$$;

CREATE FUNCTION public.set_service_online_booking(
  target_service_id uuid,
  target_enabled boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  service_tenant uuid;
BEGIN
  SELECT service.tenant_id INTO service_tenant
  FROM public.services AS service WHERE service.id = target_service_id;
  IF service_tenant IS NULL OR NOT public.current_user_has_tenant_role(
    service_tenant, ARRAY['owner']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'service not found or unavailable' USING ERRCODE = '42501';
  END IF;

  UPDATE public.services
  SET online_booking_enabled = coalesce(target_enabled, false)
  WHERE id = target_service_id AND tenant_id = service_tenant;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    service_tenant, auth.uid(), 'service.online_booking_changed', 'service',
    target_service_id,
    jsonb_build_object('enabled', coalesce(target_enabled, false))
  );
END;
$$;

-- Applies the requested time and technician to the job. The job keeps its
-- workflow status; only its assignment and schedule are filled in.
CREATE FUNCTION public.apply_booking_request(target_request_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request public.booking_requests%ROWTYPE;
  current_job_status public.job_status;
  has_conflict boolean;
BEGIN
  SELECT * INTO request FROM public.booking_requests AS candidate
  WHERE candidate.id = target_request_id
  FOR UPDATE;
  IF request.id IS NULL OR NOT public.current_user_has_tenant_role(
    request.tenant_id, ARRAY['owner', 'office']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'booking request not found' USING ERRCODE = '42501';
  END IF;
  IF request.status <> 'pending' THEN
    RAISE EXCEPTION 'booking request already decided' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('booking:' || request.tenant_id::text, 0));

  SELECT job.status INTO current_job_status FROM public.jobs AS job
  WHERE job.id = request.job_id
    AND job.tenant_id = request.tenant_id
    AND job.archived_at IS NULL;
  IF current_job_status IS NULL
    OR current_job_status IN ('cancelled', 'completed', 'closed') THEN
    RAISE EXCEPTION 'job is no longer open' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.jobs AS other
    WHERE other.tenant_id = request.tenant_id
      AND other.id <> request.job_id
      AND other.assigned_membership_id = request.suggested_membership_id
      AND other.archived_at IS NULL
      AND other.status NOT IN ('cancelled', 'completed', 'closed')
      AND other.scheduled_start_at < request.requested_end_at
      AND other.scheduled_end_at > request.requested_start_at
  ) OR EXISTS (
    SELECT 1 FROM public.staff_time_off AS time_off
    WHERE time_off.tenant_id = request.tenant_id
      AND time_off.membership_id = request.suggested_membership_id
      AND time_off.cancelled_at IS NULL
      AND time_off.starts_at < request.requested_end_at
      AND time_off.ends_at > request.requested_start_at
  ) OR NOT EXISTS (
    SELECT 1 FROM public.memberships AS membership
    WHERE membership.id = request.suggested_membership_id
      AND membership.tenant_id = request.tenant_id
      AND membership.role = 'technician'
      AND membership.status = 'active'
  )
  INTO has_conflict;
  IF has_conflict THEN
    RAISE EXCEPTION 'requested time is no longer free' USING ERRCODE = '40001';
  END IF;

  UPDATE public.jobs
  SET assigned_membership_id = request.suggested_membership_id,
      scheduled_start_at = request.requested_start_at,
      scheduled_end_at = request.requested_end_at
  WHERE id = request.job_id AND tenant_id = request.tenant_id;

  UPDATE public.booking_requests
  SET status = 'applied', decided_at = now(), decided_by_user_id = auth.uid()
  WHERE id = request.id;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    request.tenant_id, auth.uid(), 'booking.applied', 'job', request.job_id,
    jsonb_build_object('booking_request_id', request.id)
  );

  RETURN 'applied';
END;
$$;

CREATE FUNCTION public.dismiss_booking_request(target_request_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request public.booking_requests%ROWTYPE;
BEGIN
  SELECT * INTO request FROM public.booking_requests AS candidate
  WHERE candidate.id = target_request_id
  FOR UPDATE;
  IF request.id IS NULL OR NOT public.current_user_has_tenant_role(
    request.tenant_id, ARRAY['owner', 'office']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'booking request not found' USING ERRCODE = '42501';
  END IF;
  IF request.status <> 'pending' THEN
    RAISE EXCEPTION 'booking request already decided' USING ERRCODE = '22023';
  END IF;

  UPDATE public.booking_requests
  SET status = 'dismissed', decided_at = now(), decided_by_user_id = auth.uid()
  WHERE id = request.id;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    request.tenant_id, auth.uid(), 'booking.dismissed', 'job', request.job_id,
    jsonb_build_object('booking_request_id', request.id)
  );

  RETURN 'dismissed';
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_booking_page(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_booking_slots(text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_public_booking(
  text, uuid, timestamptz, text, text, text, text, text, text, text, text, boolean, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_booking_page(uuid, text, boolean, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_service_online_booking(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_booking_request(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dismiss_booking_request(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.booking_owner_email_is_current(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booking_customer_email_is_current(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booking_email_hash(text, uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_public_booking_page(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_booking_slots(text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_public_booking(
  text, uuid, timestamptz, text, text, text, text, text, text, text, text, boolean, text, text
) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_booking_page(uuid, text, boolean, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_service_online_booking(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_booking_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_booking_request(uuid) TO authenticated;
