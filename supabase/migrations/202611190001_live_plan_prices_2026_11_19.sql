-- CrewFlow360: new live plan prices.
--
-- Owner-approved on 2026-11-19: Starter $79, Growth $149, Pro $249 per month.
-- The amounts on the existing live Paddle prices change in place (same price
-- IDs), so only the stored amounts change. Seat limits and the 14-day trial
-- stay the same.

UPDATE public.billing_plans AS plan
SET
  amount_cents = new_price.amount_cents,
  updated_at = now()
FROM (
  VALUES
    ('starter_monthly', 'pri_01m6k8spcay1tgqctewmv8jhwh', 7900::bigint),
    ('growth_monthly', 'pri_01m6k8vg3stm76898n4673n648', 14900::bigint),
    ('pro_monthly', 'pri_01m6k8x4a6ehvnyex8bqtgs2ts', 24900::bigint)
) AS new_price (code, provider_price_id, amount_cents)
WHERE plan.code = new_price.code
  AND plan.provider = 'paddle'
  AND plan.provider_price_id = new_price.provider_price_id;
