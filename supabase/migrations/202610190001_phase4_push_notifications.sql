-- CrewFlow Phase 4: tenant-safe mobile push registration, preferences,
-- transactional notification events, and per-device retryable delivery.

CREATE TYPE public.mobile_platform AS ENUM ('android', 'ios');
CREATE TYPE public.push_notification_kind AS ENUM (
  'job_assigned',
  'job_rescheduled',
  'job_cancelled',
  'approval_requested'
);
CREATE TYPE public.push_event_status AS ENUM ('pending', 'sent');
CREATE TYPE public.push_delivery_status AS ENUM (
  'pending',
  'processing',
  'sent',
  'dead'
);

CREATE TABLE public.mobile_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  membership_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  device_id uuid NOT NULL,
  expo_push_token text NOT NULL,
  platform public.mobile_platform NOT NULL,
  disabled_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mobile_push_tokens_membership_tenant_fk
    FOREIGN KEY (membership_id, tenant_id)
    REFERENCES public.memberships(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT mobile_push_tokens_user_device_unique UNIQUE (user_id, device_id),
  CONSTRAINT mobile_push_tokens_token_format CHECK (
    char_length(expo_push_token) BETWEEN 20 AND 512
    AND expo_push_token ~ '^(ExpoPushToken|ExponentPushToken)\[[A-Za-z0-9_-]+\]$'
  )
);

CREATE UNIQUE INDEX mobile_push_tokens_active_token_unique
  ON public.mobile_push_tokens (expo_push_token)
  WHERE disabled_at IS NULL;
CREATE INDEX mobile_push_tokens_membership_active_idx
  ON public.mobile_push_tokens (membership_id, last_seen_at DESC)
  WHERE disabled_at IS NULL;

CREATE TABLE public.mobile_notification_preferences (
  membership_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  job_assignments_enabled boolean NOT NULL DEFAULT true,
  schedule_changes_enabled boolean NOT NULL DEFAULT true,
  cancellations_enabled boolean NOT NULL DEFAULT true,
  approvals_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mobile_notification_preferences_membership_tenant_fk
    FOREIGN KEY (membership_id, tenant_id)
    REFERENCES public.memberships(id, tenant_id)
    ON DELETE RESTRICT
);

CREATE TABLE public.push_notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  target_membership_id uuid NOT NULL,
  notification_kind public.push_notification_kind NOT NULL,
  job_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  deep_link text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  status public.push_event_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT push_notification_events_membership_tenant_fk
    FOREIGN KEY (target_membership_id, tenant_id)
    REFERENCES public.memberships(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT push_notification_events_job_tenant_fk
    FOREIGN KEY (job_id, tenant_id)
    REFERENCES public.jobs(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT push_notification_events_entity_type CHECK (
    entity_type IN ('job', 'quote', 'invoice', 'work_report')
  ),
  CONSTRAINT push_notification_events_title_length CHECK (
    char_length(title) BETWEEN 2 AND 80
  ),
  CONSTRAINT push_notification_events_body_length CHECK (
    char_length(body) BETWEEN 2 AND 180
  ),
  CONSTRAINT push_notification_events_deep_link CHECK (
    deep_link ~ '^crewflow://(jobs|approvals/(quote|invoice|report))/[0-9a-f-]{36}$'
  ),
  CONSTRAINT push_notification_events_dedupe_length CHECK (
    char_length(dedupe_key) BETWEEN 10 AND 240
  ),
  CONSTRAINT push_notification_events_sent_state CHECK (
    (status = 'pending' AND sent_at IS NULL)
    OR (status = 'sent' AND sent_at IS NOT NULL)
  )
);

CREATE INDEX push_notification_events_pending_idx
  ON public.push_notification_events (created_at, id)
  WHERE status = 'pending';

CREATE TABLE public.push_notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.push_notification_events(id)
    ON DELETE CASCADE,
  token_id uuid NOT NULL REFERENCES public.mobile_push_tokens(id)
    ON DELETE RESTRICT,
  status public.push_delivery_status NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_notification_deliveries_event_token_unique
    UNIQUE (event_id, token_id),
  CONSTRAINT push_notification_deliveries_attempts CHECK (
    attempts BETWEEN 0 AND 5
  ),
  CONSTRAINT push_notification_deliveries_error_length CHECK (
    last_error_code IS NULL OR char_length(last_error_code) <= 80
  ),
  CONSTRAINT push_notification_deliveries_state CHECK (
    (status = 'pending' AND claimed_at IS NULL AND sent_at IS NULL)
    OR (status = 'processing' AND claimed_at IS NOT NULL AND sent_at IS NULL)
    OR (status = 'sent' AND claimed_at IS NOT NULL AND sent_at IS NOT NULL)
    OR (status = 'dead' AND claimed_at IS NOT NULL AND sent_at IS NULL)
  )
);

CREATE INDEX push_notification_deliveries_claim_idx
  ON public.push_notification_deliveries (available_at, created_at, id)
  WHERE status IN ('pending', 'processing');

CREATE TRIGGER mobile_push_tokens_updated_at
BEFORE UPDATE ON public.mobile_push_tokens
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER mobile_notification_preferences_updated_at
BEFORE UPDATE ON public.mobile_notification_preferences
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER push_notification_deliveries_updated_at
BEFORE UPDATE ON public.push_notification_deliveries
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.mobile_push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_notification_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mobile_push_tokens FROM anon, authenticated;
REVOKE ALL ON public.mobile_notification_preferences FROM anon, authenticated;
REVOKE ALL ON public.push_notification_events FROM anon, authenticated;
REVOKE ALL ON public.push_notification_deliveries FROM anon, authenticated;

CREATE FUNCTION public.register_mobile_push_token(
  target_device_id uuid,
  target_expo_push_token text,
  target_platform public.mobile_platform
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_membership public.memberships%ROWTYPE;
  registered_token_id uuid;
  normalized_token text := trim(target_expo_push_token);
BEGIN
  SELECT membership.*
  INTO current_membership
  FROM public.memberships AS membership
  WHERE membership.user_id = auth.uid()
    AND membership.status = 'active';

  IF current_membership.id IS NULL THEN
    RAISE EXCEPTION 'active membership required' USING ERRCODE = '42501';
  END IF;

  IF normalized_token IS NULL
    OR char_length(normalized_token) NOT BETWEEN 20 AND 512
    OR normalized_token !~ '^(ExpoPushToken|ExponentPushToken)\[[A-Za-z0-9_-]+\]$'
  THEN
    RAISE EXCEPTION 'invalid Expo push token' USING ERRCODE = '22023';
  END IF;

  UPDATE public.mobile_push_tokens AS token
  SET disabled_at = now()
  WHERE token.expo_push_token = normalized_token
    AND token.disabled_at IS NULL
    AND (token.user_id, token.device_id)
      IS DISTINCT FROM (auth.uid(), target_device_id);

  INSERT INTO public.mobile_push_tokens (
    tenant_id,
    membership_id,
    user_id,
    device_id,
    expo_push_token,
    platform,
    disabled_at,
    last_seen_at
  ) VALUES (
    current_membership.tenant_id,
    current_membership.id,
    current_membership.user_id,
    target_device_id,
    normalized_token,
    target_platform,
    NULL,
    now()
  )
  ON CONFLICT (user_id, device_id) DO UPDATE
  SET tenant_id = EXCLUDED.tenant_id,
      membership_id = EXCLUDED.membership_id,
      expo_push_token = EXCLUDED.expo_push_token,
      platform = EXCLUDED.platform,
      disabled_at = NULL,
      last_seen_at = now()
  RETURNING id INTO registered_token_id;

  INSERT INTO public.mobile_notification_preferences (membership_id, tenant_id)
  VALUES (current_membership.id, current_membership.tenant_id)
  ON CONFLICT (membership_id) DO NOTHING;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    current_membership.tenant_id,
    auth.uid(),
    'notification.device_registered',
    'membership',
    current_membership.id,
    jsonb_build_object('platform', target_platform)
  );

  RETURN registered_token_id;
END;
$$;

CREATE FUNCTION public.disable_mobile_push_token(target_device_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.mobile_push_tokens AS token
  SET disabled_at = now()
  WHERE token.user_id = auth.uid()
    AND token.device_id = target_device_id
    AND token.disabled_at IS NULL;
END;
$$;

CREATE FUNCTION public.get_mobile_notification_preferences()
RETURNS TABLE (
  job_assignments_enabled boolean,
  schedule_changes_enabled boolean,
  cancellations_enabled boolean,
  approvals_enabled boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_membership public.memberships%ROWTYPE;
BEGIN
  SELECT membership.*
  INTO current_membership
  FROM public.memberships AS membership
  WHERE membership.user_id = auth.uid()
    AND membership.status = 'active';

  IF current_membership.id IS NULL THEN
    RAISE EXCEPTION 'active membership required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.mobile_notification_preferences (membership_id, tenant_id)
  VALUES (current_membership.id, current_membership.tenant_id)
  ON CONFLICT (membership_id) DO NOTHING;

  RETURN QUERY
  SELECT
    preference.job_assignments_enabled,
    preference.schedule_changes_enabled,
    preference.cancellations_enabled,
    preference.approvals_enabled
  FROM public.mobile_notification_preferences AS preference
  WHERE preference.membership_id = current_membership.id;
END;
$$;

CREATE FUNCTION public.update_mobile_notification_preferences(
  enable_job_assignments boolean,
  enable_schedule_changes boolean,
  enable_cancellations boolean,
  enable_approvals boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_membership public.memberships%ROWTYPE;
BEGIN
  IF enable_job_assignments IS NULL
    OR enable_schedule_changes IS NULL
    OR enable_cancellations IS NULL
    OR enable_approvals IS NULL
  THEN
    RAISE EXCEPTION 'notification preferences are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT membership.*
  INTO current_membership
  FROM public.memberships AS membership
  WHERE membership.user_id = auth.uid()
    AND membership.status = 'active';

  IF current_membership.id IS NULL THEN
    RAISE EXCEPTION 'active membership required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.mobile_notification_preferences (
    membership_id,
    tenant_id,
    job_assignments_enabled,
    schedule_changes_enabled,
    cancellations_enabled,
    approvals_enabled
  ) VALUES (
    current_membership.id,
    current_membership.tenant_id,
    enable_job_assignments,
    enable_schedule_changes,
    enable_cancellations,
    enable_approvals
  )
  ON CONFLICT (membership_id) DO UPDATE
  SET job_assignments_enabled = EXCLUDED.job_assignments_enabled,
      schedule_changes_enabled = EXCLUDED.schedule_changes_enabled,
      cancellations_enabled = EXCLUDED.cancellations_enabled,
      approvals_enabled = EXCLUDED.approvals_enabled;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    current_membership.tenant_id,
    auth.uid(),
    'notification.preferences_updated',
    'membership',
    current_membership.id,
    jsonb_build_object(
      'job_assignments_enabled', enable_job_assignments,
      'schedule_changes_enabled', enable_schedule_changes,
      'cancellations_enabled', enable_cancellations,
      'approvals_enabled', enable_approvals
    )
  );
END;
$$;

CREATE FUNCTION public.enqueue_push_notification_event(
  target_tenant_id uuid,
  target_membership_id uuid,
  target_kind public.push_notification_kind,
  target_job_id uuid,
  target_entity_type text,
  target_entity_id uuid,
  target_title text,
  target_body text,
  target_deep_link text,
  target_dedupe_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.memberships AS membership
    WHERE membership.id = target_membership_id
      AND membership.tenant_id = target_tenant_id
      AND membership.status = 'active'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.push_notification_events (
    tenant_id,
    target_membership_id,
    notification_kind,
    job_id,
    entity_type,
    entity_id,
    title,
    body,
    deep_link,
    dedupe_key
  ) VALUES (
    target_tenant_id,
    target_membership_id,
    target_kind,
    target_job_id,
    target_entity_type,
    target_entity_id,
    target_title,
    target_body,
    target_deep_link,
    target_dedupe_key
  )
  ON CONFLICT (dedupe_key) DO NOTHING;
END;
$$;

CREATE FUNCTION public.queue_job_push_notifications()
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
    event_title := 'New CrewFlow assignment';
    event_body := 'Open CrewFlow to review your new job assignment.';
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
    event_title := 'CrewFlow job cancelled';
    event_body := 'An assigned job was cancelled. Open CrewFlow for details.';
  ELSIF NEW.assigned_membership_id IS DISTINCT FROM OLD.assigned_membership_id
    AND NEW.assigned_membership_id IS NOT NULL THEN
    event_kind := 'job_assigned';
    event_title := 'New CrewFlow assignment';
    event_body := 'Open CrewFlow to review your new job assignment.';
    recipient_membership_id := NEW.assigned_membership_id;
  ELSIF NEW.assigned_membership_id IS NOT NULL
    AND (
      NEW.scheduled_start_at IS DISTINCT FROM OLD.scheduled_start_at
      OR NEW.scheduled_end_at IS DISTINCT FROM OLD.scheduled_end_at
    ) THEN
    event_kind := 'job_rescheduled';
    event_title := 'CrewFlow schedule updated';
    event_body := 'An assigned job schedule changed. Open CrewFlow for details.';
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

CREATE TRIGGER jobs_queue_push_notifications
AFTER INSERT OR UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.queue_job_push_notifications();

CREATE FUNCTION public.queue_approval_push_notifications()
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
      'A customer document is ready for review in CrewFlow.',
      'crewflow://approvals/' || approval_kind || '/' || NEW.id::text,
      'approval_requested:' || approval_kind || ':' || NEW.id::text || ':'
        || recipient.id::text
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER quotes_queue_approval_push
AFTER INSERT ON public.quotes
FOR EACH ROW WHEN (NEW.status = 'draft')
EXECUTE FUNCTION public.queue_approval_push_notifications();

CREATE TRIGGER invoices_queue_approval_push
AFTER INSERT ON public.invoices
FOR EACH ROW WHEN (NEW.status = 'draft')
EXECUTE FUNCTION public.queue_approval_push_notifications();

CREATE TRIGGER work_reports_queue_approval_push
AFTER INSERT ON public.work_reports
FOR EACH ROW WHEN (NEW.status = 'draft')
EXECUTE FUNCTION public.queue_approval_push_notifications();

CREATE FUNCTION public.claim_push_notification_deliveries(
  batch_size integer DEFAULT 50
)
RETURNS TABLE (
  delivery_id uuid,
  expo_push_token text,
  notification_kind public.push_notification_kind,
  title text,
  body text,
  deep_link text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'push batch size must be between 1 and 100'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.push_notification_deliveries AS delivery
  SET status = 'dead',
      claimed_at = coalesce(delivery.claimed_at, now()),
      last_error_code = 'token_disabled'
  FROM public.mobile_push_tokens AS token
  WHERE delivery.token_id = token.id
    AND delivery.status IN ('pending', 'processing')
    AND token.disabled_at IS NOT NULL;

  INSERT INTO public.push_notification_deliveries (event_id, token_id)
  SELECT event.id, token.id
  FROM public.push_notification_events AS event
  JOIN public.memberships AS membership
    ON membership.id = event.target_membership_id
    AND membership.tenant_id = event.tenant_id
    AND membership.status = 'active'
  JOIN public.tenant_settings AS setting
    ON setting.tenant_id = event.tenant_id
    AND setting.notifications_enabled
  JOIN public.mobile_push_tokens AS token
    ON token.membership_id = event.target_membership_id
    AND token.tenant_id = event.tenant_id
    AND token.disabled_at IS NULL
  LEFT JOIN public.mobile_notification_preferences AS preference
    ON preference.membership_id = event.target_membership_id
  WHERE event.status = 'pending'
    AND CASE event.notification_kind
      WHEN 'job_assigned' THEN coalesce(
        preference.job_assignments_enabled,
        true
      )
      WHEN 'job_rescheduled' THEN coalesce(
        preference.schedule_changes_enabled,
        true
      )
      WHEN 'job_cancelled' THEN coalesce(
        preference.cancellations_enabled,
        true
      )
      WHEN 'approval_requested' THEN coalesce(
        preference.approvals_enabled,
        true
      )
    END
  ON CONFLICT (event_id, token_id) DO NOTHING;

  UPDATE public.push_notification_events AS event
  SET status = 'sent',
      sent_at = now()
  WHERE event.status = 'pending'
    AND NOT EXISTS (
      SELECT 1
      FROM public.push_notification_deliveries AS delivery
      WHERE delivery.event_id = event.id
        AND delivery.status IN ('pending', 'processing')
    );

  RETURN QUERY
  WITH candidates AS (
    SELECT delivery.id
    FROM public.push_notification_deliveries AS delivery
    JOIN public.mobile_push_tokens AS token ON token.id = delivery.token_id
    WHERE token.disabled_at IS NULL
      AND delivery.attempts < 5
      AND (
        (delivery.status = 'pending' AND delivery.available_at <= now())
        OR (
          delivery.status = 'processing'
          AND delivery.claimed_at <= now() - interval '15 minutes'
        )
      )
    ORDER BY delivery.available_at, delivery.created_at, delivery.id
    LIMIT batch_size
    FOR UPDATE OF delivery SKIP LOCKED
  ), claimed AS (
    UPDATE public.push_notification_deliveries AS delivery
    SET status = 'processing',
        claimed_at = now(),
        attempts = delivery.attempts + 1,
        last_error_code = NULL
    FROM candidates
    WHERE delivery.id = candidates.id
    RETURNING delivery.id, delivery.event_id, delivery.token_id
  )
  SELECT
    claimed.id,
    token.expo_push_token,
    event.notification_kind,
    event.title,
    event.body,
    event.deep_link
  FROM claimed
  JOIN public.mobile_push_tokens AS token ON token.id = claimed.token_id
  JOIN public.push_notification_events AS event ON event.id = claimed.event_id;
END;
$$;

CREATE FUNCTION public.complete_push_notification_deliveries(
  target_delivery_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  completed_count integer;
BEGIN
  IF target_delivery_ids IS NULL
    OR cardinality(target_delivery_ids) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'push delivery ids must contain between 1 and 100 items'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.push_notification_deliveries AS delivery
  SET status = 'sent',
      sent_at = now()
  WHERE delivery.id = ANY(target_delivery_ids)
    AND delivery.status = 'processing';

  GET DIAGNOSTICS completed_count = ROW_COUNT;

  UPDATE public.push_notification_events AS event
  SET status = 'sent',
      sent_at = now()
  WHERE event.status = 'pending'
    AND EXISTS (
      SELECT 1
      FROM public.push_notification_deliveries AS delivery
      WHERE delivery.event_id = event.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.push_notification_deliveries AS delivery
      WHERE delivery.event_id = event.id
        AND delivery.status IN ('pending', 'processing')
    );

  RETURN completed_count;
END;
$$;

CREATE FUNCTION public.retry_push_notification_deliveries(
  target_delivery_ids uuid[],
  error_code text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  updated_count integer;
  normalized_error text := left(
    regexp_replace(coalesce(error_code, 'push_error'), '[^a-zA-Z0-9_.-]', '_', 'g'),
    80
  );
BEGIN
  IF target_delivery_ids IS NULL
    OR cardinality(target_delivery_ids) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'push delivery ids must contain between 1 and 100 items'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.push_notification_deliveries AS delivery
  SET status = CASE
        WHEN delivery.attempts >= 5 THEN 'dead'::public.push_delivery_status
        ELSE 'pending'::public.push_delivery_status
      END,
      available_at = now() + make_interval(
        mins => least(30, greatest(1, delivery.attempts * 2))
      ),
      claimed_at = CASE
        WHEN delivery.attempts >= 5 THEN delivery.claimed_at
        ELSE NULL
      END,
      last_error_code = normalized_error
  WHERE delivery.id = ANY(target_delivery_ids)
    AND delivery.status = 'processing';

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  UPDATE public.push_notification_events AS event
  SET status = 'sent',
      sent_at = now()
  WHERE event.status = 'pending'
    AND EXISTS (
      SELECT 1
      FROM public.push_notification_deliveries AS delivery
      WHERE delivery.event_id = event.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.push_notification_deliveries AS delivery
      WHERE delivery.event_id = event.id
        AND delivery.status IN ('pending', 'processing')
    );

  RETURN updated_count;
END;
$$;

CREATE FUNCTION public.disable_invalid_mobile_push_tokens(
  invalid_expo_push_tokens text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  disabled_count integer;
BEGIN
  IF invalid_expo_push_tokens IS NULL
    OR cardinality(invalid_expo_push_tokens) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid push tokens must contain between 1 and 100 items'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.mobile_push_tokens AS token
  SET disabled_at = now()
  WHERE token.expo_push_token = ANY(invalid_expo_push_tokens)
    AND token.disabled_at IS NULL;

  GET DIAGNOSTICS disabled_count = ROW_COUNT;
  RETURN disabled_count;
END;
$$;

REVOKE ALL ON FUNCTION public.register_mobile_push_token(
  uuid, text, public.mobile_platform
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_mobile_push_token(
  uuid, text, public.mobile_platform
) TO authenticated;

REVOKE ALL ON FUNCTION public.disable_mobile_push_token(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.disable_mobile_push_token(uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.get_mobile_notification_preferences()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mobile_notification_preferences()
  TO authenticated;

REVOKE ALL ON FUNCTION public.update_mobile_notification_preferences(
  boolean, boolean, boolean, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_mobile_notification_preferences(
  boolean, boolean, boolean, boolean
) TO authenticated;

REVOKE ALL ON FUNCTION public.enqueue_push_notification_event(
  uuid, uuid, public.push_notification_kind, uuid, text, uuid,
  text, text, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_job_push_notifications()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_approval_push_notifications()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.claim_push_notification_deliveries(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_notification_deliveries(integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.complete_push_notification_deliveries(uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_push_notification_deliveries(uuid[])
  TO service_role;

REVOKE ALL ON FUNCTION public.retry_push_notification_deliveries(uuid[], text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retry_push_notification_deliveries(uuid[], text)
  TO service_role;

REVOKE ALL ON FUNCTION public.disable_invalid_mobile_push_tokens(text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.disable_invalid_mobile_push_tokens(text[])
  TO service_role;

COMMENT ON TABLE public.mobile_push_tokens IS
  'Private Expo push tokens bound to an authenticated membership and app installation.';
COMMENT ON TABLE public.mobile_notification_preferences IS
  'Per-membership operational push opt-outs managed through guarded RPCs.';
COMMENT ON TABLE public.push_notification_events IS
  'Tenant-bound transactional notification events with generic, non-secret message bodies.';
COMMENT ON TABLE public.push_notification_deliveries IS
  'Per-device idempotent delivery attempts with retry leases and terminal failure state.';
