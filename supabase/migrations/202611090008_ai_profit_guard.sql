-- Job Profit Guard.
--
-- Shows owners, per service, how long completed jobs actually took and what
-- they earned, compared with the planned duration, the owner's own labor
-- cost, and optional competitor prices the owner entered with a source and
-- date. Every figure comes from the workspace's own records; CrewFlow360
-- never invents a market price. Actual time is measured from the job's
-- recorded "in progress" to "completed" status changes.

ALTER TABLE public.tenant_settings
  ADD COLUMN profit_labor_cost_cents_per_hour integer,
  ADD COLUMN profit_target_margin_bps integer NOT NULL DEFAULT 3000,
  ADD CONSTRAINT tenant_settings_profit_labor_cost CHECK (
    profit_labor_cost_cents_per_hour IS NULL
    OR profit_labor_cost_cents_per_hour BETWEEN 0 AND 100000
  ),
  ADD CONSTRAINT tenant_settings_profit_target_margin CHECK (
    profit_target_margin_bps BETWEEN 0 AND 20000
  );

ALTER TABLE public.services
  ADD COLUMN market_price_low_cents integer,
  ADD COLUMN market_price_high_cents integer,
  ADD COLUMN market_price_source text,
  ADD COLUMN market_price_checked_on date,
  ADD CONSTRAINT services_market_price_shape CHECK (
    (
      market_price_low_cents IS NULL
      AND market_price_high_cents IS NULL
      AND market_price_source IS NULL
      AND market_price_checked_on IS NULL
    ) OR (
      -- Explicit NOT NULLs: a NULL inside BETWEEN would make CHECK pass.
      market_price_low_cents IS NOT NULL
      AND market_price_high_cents IS NOT NULL
      AND market_price_source IS NOT NULL
      AND market_price_low_cents BETWEEN 0 AND 100000000
      AND market_price_high_cents BETWEEN market_price_low_cents AND 100000000
      AND char_length(trim(market_price_source)) BETWEEN 2 AND 200
      AND market_price_checked_on IS NOT NULL
    )
  );

CREATE FUNCTION public.set_service_market_price(
  target_service_id uuid,
  target_low_cents integer,
  target_high_cents integer,
  target_source text,
  target_checked_on date
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
  FROM public.services AS service
  WHERE service.id = target_service_id;

  IF service_tenant IS NULL OR NOT public.current_user_has_tenant_role(
    service_tenant, ARRAY['owner']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'only an active owner can set market prices'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.services
  SET market_price_low_cents = target_low_cents,
      market_price_high_cents = target_high_cents,
      market_price_source = nullif(trim(target_source), ''),
      market_price_checked_on = target_checked_on
  WHERE id = target_service_id;

  INSERT INTO public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    service_tenant, auth.uid(), 'service.market_price_set', 'service',
    target_service_id,
    jsonb_build_object(
      'low_cents', target_low_cents,
      'high_cents', target_high_cents,
      'source', left(target_source, 200),
      'checked_on', target_checked_on
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_service_market_price(uuid, integer, integer, text, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_service_market_price(uuid, integer, integer, text, date)
  TO authenticated;

CREATE FUNCTION public.get_service_profit_report(
  target_tenant_id uuid,
  target_days integer DEFAULT 90
)
RETURNS TABLE (
  service_id uuid,
  service_name text,
  list_price_cents integer,
  planned_minutes integer,
  completed_jobs integer,
  measured_jobs integer,
  median_minutes integer,
  average_revenue_cents bigint,
  revenue_per_hour_cents bigint,
  labor_cost_cents_per_hour integer,
  cost_per_job_cents bigint,
  margin_bps integer,
  target_margin_bps integer,
  suggested_price_cents bigint,
  market_price_low_cents integer,
  market_price_high_cents integer,
  market_price_source text,
  market_price_checked_on date,
  flags text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  labor_cost integer;
  target_margin integer;
  window_start timestamptz;
BEGIN
  IF NOT public.current_user_has_tenant_role(
    target_tenant_id, ARRAY['owner']::public.membership_role[]
  ) THEN
    RAISE EXCEPTION 'only an active owner can view profit data'
      USING ERRCODE = '42501';
  END IF;
  IF target_days IS NULL OR target_days NOT BETWEEN 7 AND 730 THEN
    RAISE EXCEPTION 'report window must be 7 to 730 days' USING ERRCODE = '22023';
  END IF;

  SELECT setting.profit_labor_cost_cents_per_hour, setting.profit_target_margin_bps
  INTO labor_cost, target_margin
  FROM public.tenant_settings AS setting
  WHERE setting.tenant_id = target_tenant_id;
  window_start := now() - make_interval(days => target_days);

  RETURN QUERY
  WITH completions AS (
    SELECT event.entity_id AS job_id, max(event.occurred_at) AS completed_at
    FROM public.audit_events AS event
    WHERE event.tenant_id = target_tenant_id
      AND event.entity_type = 'job'
      AND event.action = 'job.status_changed'
      AND event.metadata ->> 'to' = 'completed'
      AND event.occurred_at >= window_start
    GROUP BY event.entity_id
  ), timed AS (
    SELECT
      completion.job_id,
      extract(epoch FROM completion.completed_at - (
        SELECT max(start_event.occurred_at)
        FROM public.audit_events AS start_event
        WHERE start_event.tenant_id = target_tenant_id
          AND start_event.entity_type = 'job'
          AND start_event.entity_id = completion.job_id
          AND start_event.action = 'job.status_changed'
          AND start_event.metadata ->> 'to' = 'in_progress'
          AND start_event.occurred_at < completion.completed_at
      )) / 60.0 AS minutes
    FROM completions AS completion
  ), job_rows AS (
    SELECT
      job.service_id,
      CASE WHEN timed.minutes BETWEEN 5 AND 1440 THEN timed.minutes END AS minutes,
      coalesce(invoice_total.revenue, quote_total.revenue, service.unit_price_cents)::bigint
        AS revenue
    FROM timed
    JOIN public.jobs AS job
      ON job.id = timed.job_id AND job.tenant_id = target_tenant_id
    JOIN public.services AS service
      ON service.id = job.service_id AND service.tenant_id = target_tenant_id
    LEFT JOIN LATERAL (
      SELECT sum(invoice.subtotal_cents - invoice.discount_cents) AS revenue
      FROM public.invoices AS invoice
      WHERE invoice.tenant_id = target_tenant_id
        AND invoice.job_id = job.id
        AND invoice.status <> 'void'
      HAVING count(*) > 0
    ) AS invoice_total ON true
    LEFT JOIN LATERAL (
      SELECT quote.subtotal_cents - quote.discount_cents AS revenue
      FROM public.quotes AS quote
      WHERE quote.tenant_id = target_tenant_id
        AND quote.job_id = job.id
        AND quote.status = 'accepted'
      ORDER BY quote.accepted_at DESC
      LIMIT 1
    ) AS quote_total ON true
  ), per_service AS (
    SELECT
      service.id,
      service.name,
      service.unit_price_cents,
      service.default_duration_minutes,
      service.market_price_low_cents,
      service.market_price_high_cents,
      service.market_price_source,
      service.market_price_checked_on,
      count(job_rows.service_id)::integer AS completed,
      count(job_rows.minutes)::integer AS measured,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY job_rows.minutes))::integer
        AS median,
      round(avg(job_rows.revenue))::bigint AS avg_revenue
    FROM public.services AS service
    LEFT JOIN job_rows ON job_rows.service_id = service.id
    WHERE service.tenant_id = target_tenant_id
      AND service.archived_at IS NULL
    GROUP BY service.id
  ), priced AS (
    SELECT
      per_service.*,
      CASE WHEN per_service.measured > 0 AND per_service.median > 0
        THEN round(per_service.avg_revenue * 60.0 / per_service.median)::bigint
      END AS per_hour,
      CASE WHEN labor_cost IS NOT NULL AND per_service.measured > 0
        THEN round(labor_cost * per_service.median / 60.0)::bigint
      END AS job_cost
    FROM per_service
  )
  SELECT
    priced.id,
    priced.name,
    priced.unit_price_cents,
    priced.default_duration_minutes,
    priced.completed,
    priced.measured,
    priced.median,
    priced.avg_revenue,
    priced.per_hour,
    labor_cost,
    priced.job_cost,
    CASE WHEN priced.job_cost IS NOT NULL AND priced.avg_revenue > 0
      THEN round((priced.avg_revenue - priced.job_cost) * 10000.0 / priced.avg_revenue)::integer
    END,
    target_margin,
    -- Price that would reach the target margin at the measured time, rounded
    -- up to $5. Only shown when it is above today's price and data is solid.
    CASE WHEN priced.job_cost IS NOT NULL AND priced.measured >= 3
        AND target_margin < 10000
        AND ceil(priced.job_cost / (1 - target_margin / 10000.0) / 500.0) * 500
          > priced.unit_price_cents
      THEN (ceil(priced.job_cost / (1 - target_margin / 10000.0) / 500.0) * 500)::bigint
    END,
    priced.market_price_low_cents,
    priced.market_price_high_cents,
    priced.market_price_source,
    priced.market_price_checked_on,
    array_remove(ARRAY[
      CASE WHEN priced.measured < 3 THEN 'not_enough_data' END,
      CASE WHEN priced.measured >= 3
        AND priced.median > priced.default_duration_minutes * 1.25
        THEN 'takes_longer' END,
      CASE WHEN priced.job_cost IS NOT NULL AND priced.measured >= 3
        AND priced.avg_revenue < priced.job_cost
        THEN 'below_cost' END,
      CASE WHEN priced.job_cost IS NOT NULL AND priced.measured >= 3
        AND priced.avg_revenue >= priced.job_cost
        AND priced.avg_revenue > 0
        AND (priced.avg_revenue - priced.job_cost) * 10000.0 / priced.avg_revenue < target_margin
        THEN 'below_target' END,
      CASE WHEN priced.market_price_low_cents IS NOT NULL
        AND priced.unit_price_cents < priced.market_price_low_cents
        THEN 'below_market' END,
      CASE WHEN priced.market_price_high_cents IS NOT NULL
        AND priced.unit_price_cents > priced.market_price_high_cents
        THEN 'above_market' END
    ], NULL)
  FROM priced
  ORDER BY priced.completed DESC, priced.name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_service_profit_report(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_service_profit_report(uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.get_service_profit_report(uuid, integer) IS
  'Owner-only per-service time, revenue, cost, and margin from recorded job status changes, invoices, and quotes. Market prices are owner-entered with a source.';
