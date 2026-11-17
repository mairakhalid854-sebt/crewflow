-- CrewFlow360: new live plan prices.
--
-- Owner-approved on 2026-11-17: Starter $49, Growth $119, Pro $199 per month.
-- The owner edited the amounts on the existing live Paddle prices (same price
-- IDs), so only the stored amounts change. Seat limits and the 14-day trial
-- stay the same.

UPDATE public.billing_plans AS plan
SET
  amount_cents = new_price.amount_cents,
  updated_at = now()
FROM (
  VALUES
    ('starter_monthly', 'pri_01m6k8spcay1tgqctewmv8jhwh', 4900::bigint),
    ('growth_monthly', 'pri_01m6k8vg3stm76898n4673n648', 11900::bigint),
    ('pro_monthly', 'pri_01m6k8x4a6ehvnyex8bqtgs2ts', 19900::bigint)
) AS new_price (code, provider_price_id, amount_cents)
WHERE plan.code = new_price.code
  AND plan.provider = 'paddle'
  AND plan.provider_price_id = new_price.provider_price_id;
