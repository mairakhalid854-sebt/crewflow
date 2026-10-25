-- Phase 6: database-enforced guardrails for the public Intake boundary.

CREATE FUNCTION public.enforce_intake_conversation_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.tenant_id::text, 0)
  );

  IF (
    SELECT count(*)
    FROM public.intake_conversations conversation
    WHERE conversation.tenant_id = NEW.tenant_id
      AND conversation.created_at >= now() - interval '1 minute'
  ) >= 20 THEN
    RAISE EXCEPTION 'intake conversation rate limit exceeded'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER intake_conversations_rate_limit
BEFORE INSERT ON public.intake_conversations
FOR EACH ROW EXECUTE FUNCTION public.enforce_intake_conversation_rate_limit();

CREATE FUNCTION public.enforce_intake_message_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.conversation_id::text, 0)
  );

  IF (
    SELECT count(*)
    FROM public.intake_messages message
    WHERE message.conversation_id = NEW.conversation_id
      AND message.created_at >= now() - interval '1 minute'
  ) >= 40 THEN
    RAISE EXCEPTION 'intake message rate limit exceeded'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER intake_messages_rate_limit
BEFORE INSERT ON public.intake_messages
FOR EACH ROW EXECUTE FUNCTION public.enforce_intake_message_rate_limit();

CREATE FUNCTION public.record_intake_validation_error(
  target_conversation_id uuid,
  session_token text,
  customer_message text,
  assistant_message text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  conversation public.intake_conversations%ROWTYPE;
  next_sequence integer;
  next_version integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF session_token IS NULL
     OR char_length(session_token) < 43
     OR char_length(session_token) > 256 THEN
    RAISE EXCEPTION 'invalid intake session token' USING ERRCODE = '22023';
  END IF;

  IF customer_message IS NULL
     OR assistant_message IS NULL
     OR char_length(trim(customer_message)) NOT BETWEEN 1 AND 4000
     OR char_length(trim(assistant_message)) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'intake message length is invalid' USING ERRCODE = '22023';
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
  SET last_message_at = now(), version = version + 1
  WHERE id = conversation.id
  RETURNING version INTO next_version;

  RETURN next_version;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_intake_conversation_rate_limit()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_intake_message_rate_limit()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_intake_validation_error(
  uuid, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_intake_validation_error(
  uuid, text, text, text
) TO service_role;

COMMENT ON FUNCTION public.record_intake_validation_error(
  uuid, text, text, text
) IS 'Appends a rejected public Intake turn without advancing its deterministic state.';
