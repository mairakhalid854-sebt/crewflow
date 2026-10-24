-- Phase 6: persistent, tenant-bound Intake Agent conversations.
-- Public callers never receive direct table access. The API boundary generates a
-- high-entropy session token and this schema stores only its SHA-256 digest.

CREATE TYPE public.intake_conversation_status AS ENUM (
  'collecting',
  'ready_for_human_review',
  'human_takeover',
  'closed',
  'expired'
);

CREATE TYPE public.intake_conversation_stage AS ENUM (
  'name',
  'contact',
  'address',
  'problem',
  'service_confirmation',
  'complete'
);

CREATE TYPE public.intake_message_sender AS ENUM (
  'customer',
  'assistant',
  'office',
  'system'
);

ALTER TABLE public.tenant_settings
  ADD COLUMN intake_widget_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN intake_widget_key uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.tenant_settings
  ADD CONSTRAINT tenant_settings_intake_widget_key_unique
  UNIQUE (intake_widget_key);

CREATE TABLE public.intake_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  session_token_hash text NOT NULL UNIQUE,
  status public.intake_conversation_status NOT NULL DEFAULT 'collecting',
  stage public.intake_conversation_stage NOT NULL DEFAULT 'name',
  collected_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  catalog_snapshot jsonb NOT NULL,
  selected_service_id uuid,
  escalation_reason text,
  taken_over_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  taken_over_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  CONSTRAINT intake_conversations_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT intake_conversations_token_hash_format CHECK (
    session_token_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT intake_conversations_values_shape CHECK (
    jsonb_typeof(collected_values) = 'object'
    AND octet_length(collected_values::text) <= 20000
  ),
  CONSTRAINT intake_conversations_catalog_shape CHECK (
    jsonb_typeof(catalog_snapshot) = 'array'
    AND jsonb_array_length(catalog_snapshot) <= 100
    AND octet_length(catalog_snapshot::text) <= 100000
  ),
  CONSTRAINT intake_conversations_version_positive CHECK (version > 0),
  CONSTRAINT intake_conversations_expiry_window CHECK (
    expires_at > created_at
    AND expires_at <= created_at + interval '24 hours'
  ),
  CONSTRAINT intake_conversations_escalation_length CHECK (
    escalation_reason IS NULL
    OR char_length(escalation_reason) BETWEEN 3 AND 1000
  ),
  CONSTRAINT intake_conversations_takeover_shape CHECK (
    (
      status = 'human_takeover'
      AND taken_over_at IS NOT NULL
      AND escalation_reason IS NOT NULL
    ) OR (
      status <> 'human_takeover'
      AND taken_over_at IS NULL
      AND taken_over_by_user_id IS NULL
    )
  ),
  CONSTRAINT intake_conversations_completion_shape CHECK (
    (status = 'ready_for_human_review' AND stage = 'complete')
    OR status <> 'ready_for_human_review'
  )
);

CREATE INDEX intake_conversations_tenant_status_idx
  ON public.intake_conversations (tenant_id, status, updated_at DESC);
CREATE INDEX intake_conversations_expiry_idx
  ON public.intake_conversations (expires_at)
  WHERE status IN ('collecting', 'ready_for_human_review');

CREATE TABLE public.intake_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL,
  sequence_number integer NOT NULL,
  sender public.intake_message_sender NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intake_messages_conversation_tenant_fk
    FOREIGN KEY (conversation_id, tenant_id)
    REFERENCES public.intake_conversations(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT intake_messages_sequence_unique
    UNIQUE (conversation_id, sequence_number),
  CONSTRAINT intake_messages_sequence_bounds CHECK (
    sequence_number BETWEEN 1 AND 1000
  ),
  CONSTRAINT intake_messages_body_length CHECK (
    char_length(body) BETWEEN 1 AND 4000
  )
);

CREATE INDEX intake_messages_conversation_sequence_idx
  ON public.intake_messages (conversation_id, sequence_number);

CREATE FUNCTION public.reject_intake_message_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Intake messages are immutable' USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER intake_messages_immutable
BEFORE UPDATE OR DELETE ON public.intake_messages
FOR EACH ROW EXECUTE FUNCTION public.reject_intake_message_mutation();

CREATE TRIGGER intake_conversations_updated_at
BEFORE UPDATE ON public.intake_conversations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER intake_conversations_tenant_immutable
BEFORE UPDATE ON public.intake_conversations
FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_change();

CREATE FUNCTION public.open_intake_conversation(
  target_widget_key uuid,
  session_token text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_tenant_id uuid;
  conversation_id uuid;
  snapshot jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF session_token IS NULL
     OR char_length(session_token) < 43
     OR char_length(session_token) > 256 THEN
    RAISE EXCEPTION 'invalid intake session token' USING ERRCODE = '22023';
  END IF;

  SELECT settings.tenant_id INTO target_tenant_id
  FROM public.tenant_settings settings
  WHERE settings.intake_widget_key = target_widget_key
    AND settings.intake_widget_enabled
    AND settings.ai_operations_enabled;

  IF target_tenant_id IS NULL THEN
    RAISE EXCEPTION 'intake widget unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', catalog.id,
    'name', catalog.name,
    'description', catalog.description,
    'unitPriceCents', catalog.unit_price_cents
  ) ORDER BY catalog.name), '[]'::jsonb)
  INTO snapshot
  FROM (
    SELECT service.id, service.name, service.description, service.unit_price_cents
    FROM public.services service
    WHERE service.tenant_id = target_tenant_id
      AND service.is_enabled
      AND service.archived_at IS NULL
    ORDER BY service.name
    LIMIT 100
  ) catalog;

  INSERT INTO public.intake_conversations (
    tenant_id, session_token_hash, catalog_snapshot
  ) VALUES (
    target_tenant_id,
    pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(session_token, 'UTF8'), 'sha256'),
      'hex'
    ),
    snapshot
  )
  RETURNING id INTO conversation_id;

  INSERT INTO public.intake_messages (
    tenant_id, conversation_id, sequence_number, sender, body
  ) VALUES (
    target_tenant_id,
    conversation_id,
    1,
    'assistant',
    'What is your full name?'
  );

  RETURN conversation_id;
END;
$$;

CREATE FUNCTION public.record_intake_turn(
  target_conversation_id uuid,
  session_token text,
  customer_message text,
  assistant_message text,
  next_stage public.intake_conversation_stage,
  next_status public.intake_conversation_status,
  next_collected_values jsonb,
  target_selected_service_id uuid DEFAULT NULL,
  target_escalation_reason text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  conversation public.intake_conversations%ROWTYPE;
  next_sequence integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF customer_message IS NULL
     OR assistant_message IS NULL
     OR char_length(trim(customer_message)) NOT BETWEEN 1 AND 4000
     OR char_length(trim(assistant_message)) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'intake message length is invalid' USING ERRCODE = '22023';
  END IF;

  IF next_collected_values IS NULL
     OR jsonb_typeof(next_collected_values) IS DISTINCT FROM 'object'
     OR octet_length(next_collected_values::text) > 20000 THEN
    RAISE EXCEPTION 'intake values are invalid' USING ERRCODE = '22023';
  END IF;

  IF next_status IS NULL
     OR next_stage IS NULL
     OR next_status NOT IN ('collecting', 'ready_for_human_review', 'human_takeover') THEN
    RAISE EXCEPTION 'invalid intake status transition' USING ERRCODE = '22023';
  END IF;

  SELECT candidate.* INTO conversation
  FROM public.intake_conversations candidate
  WHERE candidate.id = target_conversation_id
    AND candidate.session_token_hash = pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(session_token, 'UTF8'), 'sha256'),
      'hex'
    )
  FOR UPDATE;

  IF conversation.id IS NULL THEN
    RAISE EXCEPTION 'intake conversation unavailable' USING ERRCODE = '42501';
  END IF;

  IF conversation.expires_at <= now() THEN
    RAISE EXCEPTION 'intake conversation expired' USING ERRCODE = 'P0001';
  END IF;

  IF conversation.status <> 'collecting' THEN
    RAISE EXCEPTION 'intake conversation is no longer collecting'
      USING ERRCODE = 'P0001';
  END IF;

  IF next_status = 'ready_for_human_review' AND next_stage <> 'complete' THEN
    RAISE EXCEPTION 'completed intake stage required' USING ERRCODE = '22023';
  END IF;

  IF next_status = 'collecting' AND next_stage IS DISTINCT FROM (
    CASE conversation.stage
      WHEN 'name' THEN 'contact'::public.intake_conversation_stage
      WHEN 'contact' THEN 'address'::public.intake_conversation_stage
      WHEN 'address' THEN 'problem'::public.intake_conversation_stage
      WHEN 'problem' THEN 'service_confirmation'::public.intake_conversation_stage
      ELSE NULL
    END
  ) THEN
    RAISE EXCEPTION 'invalid intake stage transition' USING ERRCODE = '22023';
  END IF;

  IF next_status = 'ready_for_human_review'
     AND (
       conversation.stage <> 'service_confirmation'
       OR target_selected_service_id IS NULL
     ) THEN
    RAISE EXCEPTION 'confirmed catalog service required' USING ERRCODE = '22023';
  END IF;

  IF next_status = 'human_takeover'
     AND nullif(trim(target_escalation_reason), '') IS NULL THEN
    RAISE EXCEPTION 'human takeover reason required' USING ERRCODE = '22023';
  END IF;

  IF target_selected_service_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(conversation.catalog_snapshot) item
    WHERE item->>'id' = target_selected_service_id::text
  ) THEN
    RAISE EXCEPTION 'selected service is outside the catalog snapshot'
      USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(max(message.sequence_number), 0) + 1 INTO next_sequence
  FROM public.intake_messages message
  WHERE message.conversation_id = conversation.id;

  IF next_sequence > 998 THEN
    RAISE EXCEPTION 'intake message limit reached' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.intake_messages (
    tenant_id, conversation_id, sequence_number, sender, body
  ) VALUES
    (
      conversation.tenant_id, conversation.id, next_sequence,
      'customer', trim(customer_message)
    ),
    (
      conversation.tenant_id, conversation.id, next_sequence + 1,
      'assistant', trim(assistant_message)
    );

  UPDATE public.intake_conversations
  SET stage = next_stage,
      status = next_status,
      collected_values = next_collected_values,
      selected_service_id = target_selected_service_id,
      escalation_reason = nullif(trim(target_escalation_reason), ''),
      taken_over_at = CASE WHEN next_status = 'human_takeover' THEN now() ELSE NULL END,
      last_message_at = now(),
      version = version + 1
  WHERE id = conversation.id
  RETURNING version INTO next_sequence;

  RETURN next_sequence;
END;
$$;

CREATE FUNCTION public.take_over_intake_conversation(
  target_conversation_id uuid,
  takeover_reason text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  conversation public.intake_conversations%ROWTYPE;
  current_user_id uuid := auth.uid();
  next_sequence integer;
  next_version integer;
BEGIN
  IF takeover_reason IS NULL
     OR char_length(trim(takeover_reason)) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'human takeover reason is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT candidate.* INTO conversation
  FROM public.intake_conversations candidate
  WHERE candidate.id = target_conversation_id
  FOR UPDATE;

  IF conversation.id IS NULL OR NOT public.current_user_has_tenant_role(
    conversation.tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'intake conversation not found or unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF conversation.status NOT IN ('collecting', 'ready_for_human_review') THEN
    RAISE EXCEPTION 'intake conversation cannot be taken over'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(max(message.sequence_number), 0) + 1 INTO next_sequence
  FROM public.intake_messages message
  WHERE message.conversation_id = conversation.id;

  INSERT INTO public.intake_messages (
    tenant_id, conversation_id, sequence_number, sender, body
  ) VALUES (
    conversation.tenant_id,
    conversation.id,
    next_sequence,
    'system',
    'An office team member joined this conversation.'
  );

  UPDATE public.intake_conversations
  SET status = 'human_takeover',
      escalation_reason = trim(takeover_reason),
      taken_over_by_user_id = current_user_id,
      taken_over_at = now(),
      last_message_at = now(),
      version = version + 1
  WHERE id = conversation.id
  RETURNING version INTO next_version;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    conversation.tenant_id,
    current_user_id,
    'ai.intake_human_takeover',
    'intake_conversation',
    conversation.id,
    jsonb_build_object('previous_status', conversation.status)
  );

  RETURN next_version;
END;
$$;

ALTER TABLE public.intake_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intake_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY intake_conversations_read_office
ON public.intake_conversations
FOR SELECT TO authenticated
USING (
  public.current_user_has_tenant_role(
    tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  )
);

CREATE POLICY intake_messages_read_office
ON public.intake_messages
FOR SELECT TO authenticated
USING (
  public.current_user_has_tenant_role(
    tenant_id,
    ARRAY['owner', 'office']::public.membership_role[]
  )
);

REVOKE ALL ON public.intake_conversations FROM anon, authenticated;
REVOKE ALL ON public.intake_messages FROM anon, authenticated;
GRANT SELECT ON public.intake_conversations TO authenticated;
GRANT SELECT ON public.intake_messages TO authenticated;

REVOKE ALL ON FUNCTION public.reject_intake_message_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.open_intake_conversation(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_intake_conversation(uuid, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.record_intake_turn(
  uuid, text, text, text, public.intake_conversation_stage,
  public.intake_conversation_status, jsonb, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_intake_turn(
  uuid, text, text, text, public.intake_conversation_stage,
  public.intake_conversation_status, jsonb, uuid, text
) TO service_role;
REVOKE ALL ON FUNCTION public.take_over_intake_conversation(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.take_over_intake_conversation(uuid, text)
  TO authenticated;

COMMENT ON COLUMN public.tenant_settings.intake_widget_key IS
  'Public tenant locator for the intake widget. It grants no data access.';
COMMENT ON TABLE public.intake_conversations IS
  'Tenant-bound intake sessions with hashed bearer tokens, bounded state, and a frozen service catalog snapshot.';
COMMENT ON TABLE public.intake_messages IS
  'Immutable, tenant-scoped intake transcript. Contains customer PII and is never exposed directly to anonymous clients.';
