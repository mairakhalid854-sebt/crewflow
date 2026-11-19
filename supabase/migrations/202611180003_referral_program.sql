-- Referral program (Batch 1, feature 2).
--
-- Each customer can get a personal referral code. A friend who books through
-- /book/<slug>?ref=<code> is linked to the customer who referred them. When
-- the friend's job is completed, the referral "qualifies" and the business
-- gives both people the reward it chose (for example $25 off). Rewards are
-- tracked here and given by the business; nothing is charged or credited
-- automatically.
--
-- Off by default: nothing happens until an owner turns the program on.

CREATE TABLE public.referral_programs (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT false,
  referrer_reward_cents integer NOT NULL DEFAULT 2500,
  friend_reward_cents integer NOT NULL DEFAULT 2500,
  reward_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_programs_rewards_range CHECK (
    referrer_reward_cents BETWEEN 0 AND 100000
    AND friend_reward_cents BETWEEN 0 AND 100000
  ),
  CONSTRAINT referral_programs_note_length CHECK (
    reward_note IS NULL OR char_length(reward_note) BETWEEN 1 AND 240
  )
);

CREATE TABLE public.customer_referral_codes (
  customer_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_referral_codes_customer_fk FOREIGN KEY (customer_id, tenant_id)
    REFERENCES public.customers(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT customer_referral_codes_code_unique UNIQUE (code),
  CONSTRAINT customer_referral_codes_code_format CHECK (code ~ '^[A-Z0-9]{8}$')
);

CREATE TABLE public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  referrer_customer_id uuid NOT NULL,
  referred_customer_id uuid NOT NULL,
  job_id uuid NOT NULL,
  booking_request_id uuid NOT NULL REFERENCES public.booking_requests(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending',
  referrer_reward_cents integer NOT NULL,
  friend_reward_cents integer NOT NULL,
  qualified_at timestamptz,
  rewarded_at timestamptz,
  rewarded_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referrals_referrer_fk FOREIGN KEY (referrer_customer_id, tenant_id)
    REFERENCES public.customers(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT referrals_referred_fk FOREIGN KEY (referred_customer_id, tenant_id)
    REFERENCES public.customers(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT referrals_job_fk FOREIGN KEY (job_id, tenant_id)
    REFERENCES public.jobs(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT referrals_job_unique UNIQUE (job_id),
  CONSTRAINT referrals_booking_unique UNIQUE (booking_request_id),
  CONSTRAINT referrals_one_per_friend UNIQUE (tenant_id, referred_customer_id),
  CONSTRAINT referrals_not_self CHECK (referrer_customer_id <> referred_customer_id),
  CONSTRAINT referrals_status CHECK (
    status IN ('pending', 'qualified', 'rewarded', 'void')
  ),
  CONSTRAINT referrals_lifecycle CHECK (
    (status = 'pending' AND qualified_at IS NULL AND rewarded_at IS NULL)
    OR (status = 'qualified' AND qualified_at IS NOT NULL AND rewarded_at IS NULL)
    OR (status = 'rewarded' AND qualified_at IS NOT NULL AND rewarded_at IS NOT NULL)
    OR (status = 'void' AND void_reason IS NOT NULL)
  ),
  CONSTRAINT referrals_void_reason_length CHECK (
    void_reason IS NULL OR char_length(void_reason) BETWEEN 3 AND 240
  ),
  CONSTRAINT referrals_rewards_range CHECK (
    referrer_reward_cents BETWEEN 0 AND 100000
    AND friend_reward_cents BETWEEN 0 AND 100000
  )
);

CREATE INDEX referrals_tenant_status_idx
  ON public.referrals (tenant_id, status, created_at DESC);
CREATE INDEX referrals_referrer_idx
  ON public.referrals (tenant_id, referrer_customer_id);

CREATE TRIGGER referral_programs_updated_at
BEFORE UPDATE ON public.referral_programs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER referral_programs_require_write_entitlement
BEFORE INSERT OR UPDATE OR DELETE ON public.referral_programs
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_write_entitlement();

ALTER TABLE public.referral_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.referral_programs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.customer_referral_codes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.referrals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.referral_programs TO authenticated;
GRANT SELECT ON public.customer_referral_codes TO authenticated;
GRANT SELECT ON public.referrals TO authenticated;

CREATE POLICY referral_programs_select ON public.referral_programs
  FOR SELECT TO authenticated
  USING (
    public.current_user_has_tenant_role(
      tenant_id, ARRAY['owner', 'office']::public.membership_role[]
    )
  );

CREATE POLICY customer_referral_codes_select ON public.customer_referral_codes
  FOR SELECT TO authenticated
  USING (
    public.current_user_has_tenant_role(
      tenant_id, ARRAY['owner', 'office']::public.membership_role[]
    )
  );

CREATE POLICY referrals_select ON public.referrals
  FOR SELECT TO authenticated
  USING (
    public.current_user_has_tenant_role(
      tenant_id, ARRAY['owner', 'office']::public.membership_role[]
    )
  );

-- ---------------------------------------------------------------------------
-- Codes
-- ---------------------------------------------------------------------------

-- Returns the customer's code, creating one when missing. Internal: callers
-- check permissions first.
CREATE FUNCTION public.ensure_customer_referral_code(target_customer_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  existing text;
  customer_tenant uuid;
  candidate text;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  attempt integer := 0;
BEGIN
  SELECT referral.code INTO existing
  FROM public.customer_referral_codes AS referral
  WHERE referral.customer_id = target_customer_id;
  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;

  SELECT customer.tenant_id INTO customer_tenant
  FROM public.customers AS customer
  WHERE customer.id = target_customer_id AND customer.archived_at IS NULL;
  IF customer_tenant IS NULL THEN
    RAISE EXCEPTION 'customer not found' USING ERRCODE = 'P0002';
  END IF;

  LOOP
    attempt := attempt + 1;
    SELECT string_agg(
      substr(alphabet, 1 + (get_byte(random_bytes.value, byte_index.value) % 32), 1), ''
    )
    INTO candidate
    FROM (SELECT extensions.gen_random_bytes(8) AS value) AS random_bytes
    CROSS JOIN generate_series(0, 7) AS byte_index(value);

    BEGIN
      INSERT INTO public.customer_referral_codes (customer_id, tenant_id, code)
      VALUES (target_customer_id, customer_tenant, candidate);
      RETURN candidate;
    EXCEPTION WHEN unique_violation THEN
      SELECT referral.code INTO existing
      FROM public.customer_referral_codes AS referral
      WHERE referral.customer_id = target_customer_id;
      IF existing IS NOT NULL THEN
        RETURN existing;
      END IF;
      IF attempt >= 5 THEN
        RAISE;
      END IF;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_customer_referral_code(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_customer_referral_code(target_customer_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  customer_tenant uuid;
BEGIN
  SELECT customer.tenant_id INTO customer_tenant
  FROM public.customers AS customer WHERE customer.id = target_customer_id;
  IF customer_tenant IS NULL OR NOT public.current_user_has_tenant_role(
    customer_tenant, ARRAY['owner', 'office']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'customer not found or unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN public.ensure_customer_referral_code(target_customer_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Linking bookings to referrers, and qualifying them
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.link_booking_referral()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  program public.referral_programs%ROWTYPE;
  referrer uuid;
  new_referral uuid;
BEGIN
  IF NEW.referral_code IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO program FROM public.referral_programs AS candidate
  WHERE candidate.tenant_id = NEW.tenant_id AND candidate.enabled;
  IF program.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT referral.customer_id INTO referrer
  FROM public.customer_referral_codes AS referral
  JOIN public.customers AS customer
    ON customer.id = referral.customer_id AND customer.tenant_id = referral.tenant_id
  WHERE referral.code = NEW.referral_code
    AND referral.tenant_id = NEW.tenant_id
    AND customer.archived_at IS NULL;

  -- Unknown code, self-referral, or a friend already referred once: ignore.
  IF referrer IS NULL OR referrer = NEW.customer_id OR EXISTS (
    SELECT 1 FROM public.referrals AS earlier
    WHERE earlier.tenant_id = NEW.tenant_id
      AND earlier.referred_customer_id = NEW.customer_id
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.referrals (
    tenant_id, referrer_customer_id, referred_customer_id, job_id,
    booking_request_id, referrer_reward_cents, friend_reward_cents
  ) VALUES (
    NEW.tenant_id, referrer, NEW.customer_id, NEW.job_id, NEW.id,
    program.referrer_reward_cents, program.friend_reward_cents
  )
  RETURNING id INTO new_referral;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    NEW.tenant_id, NULL, 'referral.created', 'job', NEW.job_id,
    jsonb_build_object(
      'referral_id', new_referral,
      'referrer_customer_id', referrer,
      'referred_customer_id', NEW.customer_id
    )
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.link_booking_referral() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER booking_requests_link_referral
AFTER INSERT ON public.booking_requests
FOR EACH ROW EXECUTE FUNCTION public.link_booking_referral();

CREATE FUNCTION public.qualify_referral_on_job_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    UPDATE public.referrals
    SET status = 'qualified', qualified_at = now()
    WHERE job_id = NEW.id
      AND tenant_id = NEW.tenant_id
      AND status = 'pending';
  ELSIF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.referrals
    SET status = 'void', void_reason = 'The referred job was cancelled.'
    WHERE job_id = NEW.id
      AND tenant_id = NEW.tenant_id
      AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.qualify_referral_on_job_completion()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER jobs_qualify_referral
AFTER UPDATE OF status ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.qualify_referral_on_job_completion();

-- ---------------------------------------------------------------------------
-- Owner and office RPCs
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.save_referral_program(
  target_tenant_id uuid,
  target_enabled boolean,
  target_referrer_reward_cents integer,
  target_friend_reward_cents integer,
  target_reward_note text DEFAULT NULL
)
RETURNS public.referral_programs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  saved public.referral_programs;
BEGIN
  IF NOT public.current_user_has_tenant_role(
    target_tenant_id, ARRAY['owner']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'owner role required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.referral_programs (
    tenant_id, enabled, referrer_reward_cents, friend_reward_cents, reward_note
  ) VALUES (
    target_tenant_id, coalesce(target_enabled, false),
    target_referrer_reward_cents, target_friend_reward_cents,
    nullif(trim(coalesce(target_reward_note, '')), '')
  )
  ON CONFLICT (tenant_id) DO UPDATE
  SET enabled = EXCLUDED.enabled,
      referrer_reward_cents = EXCLUDED.referrer_reward_cents,
      friend_reward_cents = EXCLUDED.friend_reward_cents,
      reward_note = EXCLUDED.reward_note
  RETURNING * INTO saved;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    target_tenant_id, auth.uid(), 'referral_program.saved', 'tenant', target_tenant_id,
    jsonb_build_object(
      'enabled', saved.enabled,
      'referrer_reward_cents', saved.referrer_reward_cents,
      'friend_reward_cents', saved.friend_reward_cents
    )
  );

  RETURN saved;
END;
$$;

CREATE FUNCTION public.mark_referral_rewarded(target_referral_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  referral public.referrals%ROWTYPE;
BEGIN
  SELECT * INTO referral FROM public.referrals AS candidate
  WHERE candidate.id = target_referral_id
  FOR UPDATE;
  IF referral.id IS NULL OR NOT public.current_user_has_tenant_role(
    referral.tenant_id, ARRAY['owner', 'office']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'referral not found' USING ERRCODE = '42501';
  END IF;
  IF referral.status <> 'qualified' THEN
    RAISE EXCEPTION 'only qualified referrals can be rewarded' USING ERRCODE = '22023';
  END IF;

  UPDATE public.referrals
  SET status = 'rewarded', rewarded_at = now(), rewarded_by_user_id = auth.uid()
  WHERE id = referral.id;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    referral.tenant_id, auth.uid(), 'referral.rewarded', 'job', referral.job_id,
    jsonb_build_object(
      'referral_id', referral.id,
      'referrer_reward_cents', referral.referrer_reward_cents,
      'friend_reward_cents', referral.friend_reward_cents
    )
  );

  RETURN 'rewarded';
END;
$$;

CREATE FUNCTION public.void_referral(target_referral_id uuid, target_reason text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  referral public.referrals%ROWTYPE;
  reason text := left(trim(coalesce(target_reason, '')), 240);
BEGIN
  SELECT * INTO referral FROM public.referrals AS candidate
  WHERE candidate.id = target_referral_id
  FOR UPDATE;
  IF referral.id IS NULL OR NOT public.current_user_has_tenant_role(
    referral.tenant_id, ARRAY['owner', 'office']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'referral not found' USING ERRCODE = '42501';
  END IF;
  IF referral.status NOT IN ('pending', 'qualified') THEN
    RAISE EXCEPTION 'referral can no longer be voided' USING ERRCODE = '22023';
  END IF;
  IF char_length(reason) < 3 THEN
    RAISE EXCEPTION 'reason required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.referrals
  SET status = 'void', void_reason = reason
  WHERE id = referral.id;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    referral.tenant_id, auth.uid(), 'referral.voided', 'job', referral.job_id,
    jsonb_build_object('referral_id', referral.id, 'reason', reason)
  );

  RETURN 'void';
END;
$$;

-- ---------------------------------------------------------------------------
-- Public RPCs (anon)
-- ---------------------------------------------------------------------------

-- What a referred friend sees on the booking page. Shows only the referrer's
-- first name and last initial.
CREATE FUNCTION public.get_public_referral_offer(target_slug text, target_code text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'referrer_name',
      customer.first_name || ' ' || left(customer.last_name, 1) || '.',
    'friend_reward_cents', program.friend_reward_cents,
    'reward_note', program.reward_note
  )
  FROM public.customer_referral_codes AS referral
  JOIN public.customers AS customer
    ON customer.id = referral.customer_id AND customer.tenant_id = referral.tenant_id
  JOIN public.referral_programs AS program
    ON program.tenant_id = referral.tenant_id AND program.enabled
  WHERE referral.code = upper(trim(target_code))
    AND upper(trim(target_code)) ~ '^[A-Z0-9]{8}$'
    AND referral.tenant_id = public.live_booking_tenant(target_slug)
    AND customer.archived_at IS NULL;
$$;

-- The "refer a friend" box on a sent work report. Creates the customer's
-- code on first view when the program and booking page are both on.
CREATE FUNCTION public.get_report_referral_invite(report_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  report_customer uuid;
  report_tenant uuid;
  page_slug text;
  program public.referral_programs%ROWTYPE;
BEGIN
  IF report_token IS NULL OR report_token !~ '^[0-9a-f]{64}$' THEN
    RETURN NULL;
  END IF;

  SELECT report.customer_id, report.tenant_id
  INTO report_customer, report_tenant
  FROM public.work_reports AS report
  JOIN public.customers AS customer
    ON customer.id = report.customer_id AND customer.tenant_id = report.tenant_id
  WHERE report.public_token_hash = pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(report_token, 'UTF8'), 'sha256'),
      'hex'
    )
    AND report.status = 'sent'
    AND customer.archived_at IS NULL;
  IF report_customer IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO program FROM public.referral_programs AS candidate
  WHERE candidate.tenant_id = report_tenant AND candidate.enabled;
  SELECT page.slug INTO page_slug FROM public.booking_pages AS page
  WHERE page.tenant_id = report_tenant;
  IF program.tenant_id IS NULL OR page_slug IS NULL
    OR public.live_booking_tenant(page_slug) IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'slug', page_slug,
    'code', public.ensure_customer_referral_code(report_customer),
    'referrer_reward_cents', program.referrer_reward_cents,
    'friend_reward_cents', program.friend_reward_cents,
    'reward_note', program.reward_note
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_referral_code(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_referral_program(uuid, boolean, integer, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_referral_rewarded(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.void_referral(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_public_referral_offer(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_report_referral_invite(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_customer_referral_code(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_referral_program(uuid, boolean, integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_referral_rewarded(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_referral(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_referral_offer(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_report_referral_invite(text) TO anon, authenticated;
