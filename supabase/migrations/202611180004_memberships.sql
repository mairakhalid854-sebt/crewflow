-- Maintenance plans / memberships (Batch 1, feature 3).
--
-- A business defines plans (for example "Comfort Club: $15 a month, two
-- tune-ups a year, 10% off repairs") and enrolls customers. Each enrollment
-- keeps a snapshot of the plan terms. A daily job creates a "new" job for
-- every visit that is due within the next 14 days, so no visit is forgotten;
-- the office then schedules it like any other job. Renewal dates roll forward
-- automatically. Payments are billed by the business through normal invoices;
-- nothing is charged automatically.
--
-- Off by default: nothing happens until an owner creates a plan.

CREATE TABLE public.membership_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  name text NOT NULL,
  description text,
  price_cents integer NOT NULL,
  billing_interval text NOT NULL DEFAULT 'monthly',
  visits_per_year integer NOT NULL DEFAULT 2,
  discount_percent integer NOT NULL DEFAULT 0,
  service_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_plans_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT membership_plans_name_unique UNIQUE (tenant_id, name),
  CONSTRAINT membership_plans_service_fk FOREIGN KEY (service_id, tenant_id)
    REFERENCES public.services(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT membership_plans_name_length CHECK (char_length(name) BETWEEN 2 AND 80),
  CONSTRAINT membership_plans_description_length CHECK (
    description IS NULL OR char_length(description) BETWEEN 1 AND 600
  ),
  CONSTRAINT membership_plans_price_range CHECK (price_cents BETWEEN 0 AND 1000000),
  CONSTRAINT membership_plans_interval CHECK (billing_interval IN ('monthly', 'yearly')),
  CONSTRAINT membership_plans_visits CHECK (visits_per_year IN (1, 2, 3, 4, 6, 12)),
  CONSTRAINT membership_plans_discount_range CHECK (discount_percent BETWEEN 0 AND 50)
);

CREATE TABLE public.customer_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active',
  plan_name text NOT NULL,
  price_cents integer NOT NULL,
  billing_interval text NOT NULL,
  visits_per_year integer NOT NULL,
  discount_percent integer NOT NULL,
  service_id uuid,
  started_on date NOT NULL,
  renews_on date NOT NULL,
  next_visit_on date NOT NULL,
  cancelled_at timestamptz,
  cancel_reason text,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_memberships_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT customer_memberships_customer_fk FOREIGN KEY (customer_id, tenant_id)
    REFERENCES public.customers(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT customer_memberships_plan_fk FOREIGN KEY (plan_id, tenant_id)
    REFERENCES public.membership_plans(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT customer_memberships_service_fk FOREIGN KEY (service_id, tenant_id)
    REFERENCES public.services(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT customer_memberships_status CHECK (status IN ('active', 'cancelled')),
  CONSTRAINT customer_memberships_cancel_shape CHECK (
    (status = 'active' AND cancelled_at IS NULL AND cancel_reason IS NULL)
    OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL)
  ),
  CONSTRAINT customer_memberships_cancel_reason_length CHECK (
    cancel_reason IS NULL OR char_length(cancel_reason) BETWEEN 3 AND 240
  ),
  CONSTRAINT customer_memberships_interval CHECK (billing_interval IN ('monthly', 'yearly')),
  CONSTRAINT customer_memberships_visits CHECK (visits_per_year IN (1, 2, 3, 4, 6, 12)),
  CONSTRAINT customer_memberships_price_range CHECK (price_cents BETWEEN 0 AND 1000000),
  CONSTRAINT customer_memberships_discount_range CHECK (discount_percent BETWEEN 0 AND 50),
  CONSTRAINT customer_memberships_dates CHECK (
    renews_on > started_on AND next_visit_on >= started_on
  )
);

CREATE UNIQUE INDEX customer_memberships_one_active_per_plan
  ON public.customer_memberships (customer_id, plan_id)
  WHERE status = 'active';
CREATE INDEX customer_memberships_due_idx
  ON public.customer_memberships (tenant_id, next_visit_on)
  WHERE status = 'active';

CREATE TABLE public.membership_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  customer_membership_id uuid NOT NULL,
  job_id uuid NOT NULL,
  due_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_visits_membership_fk
    FOREIGN KEY (customer_membership_id, tenant_id)
    REFERENCES public.customer_memberships(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT membership_visits_job_fk FOREIGN KEY (job_id, tenant_id)
    REFERENCES public.jobs(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT membership_visits_job_unique UNIQUE (job_id),
  CONSTRAINT membership_visits_once_per_due_date UNIQUE (customer_membership_id, due_on)
);

CREATE INDEX membership_visits_tenant_idx
  ON public.membership_visits (tenant_id, due_on DESC);

CREATE TRIGGER membership_plans_updated_at
BEFORE UPDATE ON public.membership_plans
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER customer_memberships_updated_at
BEFORE UPDATE ON public.customer_memberships
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER membership_plans_require_write_entitlement
BEFORE INSERT OR UPDATE OR DELETE ON public.membership_plans
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_write_entitlement();
CREATE TRIGGER customer_memberships_require_write_entitlement
BEFORE INSERT OR UPDATE OR DELETE ON public.customer_memberships
FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_write_entitlement();

ALTER TABLE public.membership_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_visits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.membership_plans FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.customer_memberships FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.membership_visits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.membership_plans TO authenticated;
GRANT SELECT ON public.customer_memberships TO authenticated;
GRANT SELECT ON public.membership_visits TO authenticated;

CREATE POLICY membership_plans_select ON public.membership_plans
  FOR SELECT TO authenticated
  USING (
    public.current_user_has_tenant_role(
      tenant_id, ARRAY['owner', 'office']::public.membership_role[]
    )
  );
CREATE POLICY customer_memberships_select ON public.customer_memberships
  FOR SELECT TO authenticated
  USING (
    public.current_user_has_tenant_role(
      tenant_id, ARRAY['owner', 'office']::public.membership_role[]
    )
  );
CREATE POLICY membership_visits_select ON public.membership_visits
  FOR SELECT TO authenticated
  USING (
    public.current_user_has_tenant_role(
      tenant_id, ARRAY['owner', 'office']::public.membership_role[]
    )
  );

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.save_membership_plan(
  target_tenant_id uuid,
  target_plan_id uuid,
  target_name text,
  target_description text,
  target_price_cents integer,
  target_billing_interval text,
  target_visits_per_year integer,
  target_discount_percent integer,
  target_service_id uuid,
  target_is_active boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  saved_id uuid;
BEGIN
  IF NOT public.current_user_has_tenant_role(
    target_tenant_id, ARRAY['owner']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'owner role required' USING ERRCODE = '42501';
  END IF;

  IF target_plan_id IS NULL THEN
    INSERT INTO public.membership_plans (
      tenant_id, name, description, price_cents, billing_interval,
      visits_per_year, discount_percent, service_id, is_active
    ) VALUES (
      target_tenant_id, trim(target_name),
      nullif(trim(coalesce(target_description, '')), ''),
      target_price_cents, target_billing_interval, target_visits_per_year,
      target_discount_percent, target_service_id, coalesce(target_is_active, true)
    ) RETURNING id INTO saved_id;
  ELSE
    UPDATE public.membership_plans
    SET name = trim(target_name),
        description = nullif(trim(coalesce(target_description, '')), ''),
        price_cents = target_price_cents,
        billing_interval = target_billing_interval,
        visits_per_year = target_visits_per_year,
        discount_percent = target_discount_percent,
        service_id = target_service_id,
        is_active = coalesce(target_is_active, true)
    WHERE id = target_plan_id AND tenant_id = target_tenant_id
    RETURNING id INTO saved_id;
    IF saved_id IS NULL THEN
      RAISE EXCEPTION 'plan not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    target_tenant_id, auth.uid(), 'membership_plan.saved', 'membership_plan', saved_id,
    jsonb_build_object(
      'name', trim(target_name),
      'price_cents', target_price_cents,
      'billing_interval', target_billing_interval,
      'visits_per_year', target_visits_per_year,
      'is_active', coalesce(target_is_active, true)
    )
  );

  RETURN saved_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Enrollments
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.enroll_customer_membership(
  target_customer_id uuid,
  target_plan_id uuid,
  target_started_on date,
  target_first_visit_on date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  plan public.membership_plans%ROWTYPE;
  customer_tenant uuid;
  new_membership uuid;
  start_date date := coalesce(target_started_on, current_date);
BEGIN
  SELECT customer.tenant_id INTO customer_tenant
  FROM public.customers AS customer
  WHERE customer.id = target_customer_id AND customer.archived_at IS NULL;
  IF customer_tenant IS NULL OR NOT public.current_user_has_tenant_role(
    customer_tenant, ARRAY['owner', 'office']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'customer not found or unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO plan FROM public.membership_plans AS candidate
  WHERE candidate.id = target_plan_id
    AND candidate.tenant_id = customer_tenant
    AND candidate.is_active;
  IF plan.id IS NULL THEN
    RAISE EXCEPTION 'plan not available' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.customer_memberships AS existing
    WHERE existing.customer_id = target_customer_id
      AND existing.plan_id = target_plan_id
      AND existing.status = 'active'
  ) THEN
    RAISE EXCEPTION 'customer already has this plan' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.customer_memberships (
    tenant_id, customer_id, plan_id, plan_name, price_cents, billing_interval,
    visits_per_year, discount_percent, service_id, started_on, renews_on,
    next_visit_on, created_by_user_id
  ) VALUES (
    customer_tenant, target_customer_id, plan.id, plan.name, plan.price_cents,
    plan.billing_interval, plan.visits_per_year, plan.discount_percent,
    plan.service_id, start_date,
    (start_date + CASE plan.billing_interval
      WHEN 'yearly' THEN interval '1 year' ELSE interval '1 month' END)::date,
    greatest(coalesce(target_first_visit_on, start_date), start_date),
    auth.uid()
  ) RETURNING id INTO new_membership;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    customer_tenant, auth.uid(), 'membership.enrolled', 'customer', target_customer_id,
    jsonb_build_object('customer_membership_id', new_membership, 'plan', plan.name)
  );

  RETURN new_membership;
END;
$$;

CREATE FUNCTION public.cancel_customer_membership(
  target_membership_id uuid,
  target_reason text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  enrollment public.customer_memberships%ROWTYPE;
  reason text := left(trim(coalesce(target_reason, '')), 240);
BEGIN
  SELECT * INTO enrollment FROM public.customer_memberships AS candidate
  WHERE candidate.id = target_membership_id
  FOR UPDATE;
  IF enrollment.id IS NULL OR NOT public.current_user_has_tenant_role(
    enrollment.tenant_id, ARRAY['owner', 'office']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'membership not found' USING ERRCODE = '42501';
  END IF;
  IF enrollment.status <> 'active' THEN
    RAISE EXCEPTION 'membership already cancelled' USING ERRCODE = '22023';
  END IF;
  IF char_length(reason) < 3 THEN
    RAISE EXCEPTION 'reason required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.customer_memberships
  SET status = 'cancelled', cancelled_at = now(), cancel_reason = reason
  WHERE id = enrollment.id;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    enrollment.tenant_id, auth.uid(), 'membership.cancelled', 'customer',
    enrollment.customer_id,
    jsonb_build_object('customer_membership_id', enrollment.id, 'reason', reason)
  );

  RETURN 'cancelled';
END;
$$;

-- ---------------------------------------------------------------------------
-- Daily scheduler
-- ---------------------------------------------------------------------------

-- Creates at most one visit job per active membership per run, for visits
-- due within 14 days of the business's local date, and rolls renewal dates
-- forward. Workspaces without write access are skipped. Returns the number
-- of visit jobs created.
CREATE FUNCTION public.create_due_membership_visits(
  target_tenant_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  enrollment record;
  new_job uuid;
  created integer := 0;
  months_between integer;
BEGIN
  -- Renewal dates roll forward while a membership stays active.
  UPDATE public.customer_memberships AS membership
  SET renews_on = (membership.renews_on + CASE membership.billing_interval
      WHEN 'yearly' THEN interval '1 year' ELSE interval '1 month' END)::date
  FROM public.tenants AS tenant
  WHERE tenant.id = membership.tenant_id
    AND membership.status = 'active'
    AND membership.renews_on <= (now() AT TIME ZONE tenant.time_zone)::date
    AND (target_tenant_id IS NULL OR membership.tenant_id = target_tenant_id);

  FOR enrollment IN
    SELECT membership.*, service.name AS service_name,
      (now() AT TIME ZONE tenant.time_zone)::date AS local_today
    FROM public.customer_memberships AS membership
    JOIN public.tenants AS tenant ON tenant.id = membership.tenant_id
    JOIN public.tenant_subscriptions AS subscription
      ON subscription.tenant_id = membership.tenant_id
    JOIN public.customers AS customer
      ON customer.id = membership.customer_id AND customer.tenant_id = membership.tenant_id
    LEFT JOIN public.services AS service
      ON service.id = membership.service_id AND service.tenant_id = membership.tenant_id
    WHERE membership.status = 'active'
      AND customer.archived_at IS NULL
      AND subscription.access_mode IN ('full', 'grace')
      AND membership.next_visit_on
        <= (now() AT TIME ZONE tenant.time_zone)::date + 14
      AND (target_tenant_id IS NULL OR membership.tenant_id = target_tenant_id)
    ORDER BY membership.next_visit_on
    FOR UPDATE OF membership SKIP LOCKED
  LOOP
    months_between := 12 / enrollment.visits_per_year;

    IF NOT EXISTS (
      SELECT 1 FROM public.membership_visits AS visit
      WHERE visit.customer_membership_id = enrollment.id
        AND visit.due_on = enrollment.next_visit_on
    ) THEN
      INSERT INTO public.jobs (
        tenant_id, customer_id, service_id, title, description, priority, status
      ) VALUES (
        enrollment.tenant_id, enrollment.customer_id, enrollment.service_id,
        left(enrollment.plan_name || ' visit'
          || CASE WHEN enrollment.service_name IS NOT NULL
            THEN ': ' || enrollment.service_name ELSE '' END, 160),
        format(
          'Membership visit due %s (%s plan). Member discount: %s%%. Created automatically; please schedule it.',
          to_char(enrollment.next_visit_on, 'FMMonth FMDD, YYYY'),
          enrollment.plan_name,
          enrollment.discount_percent
        ),
        'normal', 'new'
      ) RETURNING id INTO new_job;

      INSERT INTO public.membership_visits (
        tenant_id, customer_membership_id, job_id, due_on
      ) VALUES (
        enrollment.tenant_id, enrollment.id, new_job, enrollment.next_visit_on
      );

      INSERT INTO public.audit_events (
        tenant_id, actor_user_id, action, entity_type, entity_id, metadata
      ) VALUES (
        enrollment.tenant_id, auth.uid(), 'membership.visit_created', 'job', new_job,
        jsonb_build_object(
          'customer_membership_id', enrollment.id,
          'due_on', enrollment.next_visit_on
        )
      );
      created := created + 1;
    END IF;

    UPDATE public.customer_memberships
    SET next_visit_on = (enrollment.next_visit_on
      + make_interval(months => months_between))::date
    WHERE id = enrollment.id;
  END LOOP;

  RETURN created;
END;
$$;

REVOKE ALL ON FUNCTION public.create_due_membership_visits(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_due_membership_visits(uuid) TO service_role;

-- Lets the office create due visits now instead of waiting for the daily run.
CREATE FUNCTION public.create_my_due_membership_visits(target_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.current_user_has_tenant_role(
    target_tenant_id, ARRAY['owner', 'office']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'owner or office role required' USING ERRCODE = '42501';
  END IF;
  RETURN public.create_due_membership_visits(target_tenant_id);
END;
$$;

REVOKE ALL ON FUNCTION public.save_membership_plan(
  uuid, uuid, text, text, integer, text, integer, integer, uuid, boolean
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enroll_customer_membership(uuid, uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_customer_membership(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_my_due_membership_visits(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_membership_plan(
  uuid, uuid, text, text, integer, text, integer, integer, uuid, boolean
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enroll_customer_membership(uuid, uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_customer_membership(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_my_due_membership_visits(uuid) TO authenticated;

DO $$
DECLARE existing_job_id bigint;
BEGIN
  SELECT jobid INTO existing_job_id
  FROM cron.job WHERE jobname = 'crewflow-membership-visits-daily' LIMIT 1;
  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;
  PERFORM cron.schedule(
    'crewflow-membership-visits-daily',
    '30 11 * * *',
    'SELECT public.create_due_membership_visits(NULL);'
  );
END;
$$;

COMMENT ON FUNCTION public.create_due_membership_visits(uuid) IS
  'Daily: creates one new job per active membership visit due within 14 days and rolls renewal dates forward.';
