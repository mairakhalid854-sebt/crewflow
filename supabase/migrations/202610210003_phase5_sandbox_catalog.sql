-- Paddle sandbox catalog created for CrewFlow subscription checkout.
-- Paddle product and price identifiers are public catalog references, not credentials.

INSERT INTO public.billing_plans (
  code, provider, display_name, billing_interval, provider_price_id,
  amount_cents, currency_code, seat_limit, ai_monthly_budget_cents,
  trial_days, is_active, is_development_only
) VALUES
  ('starter_monthly_sandbox', 'paddle_sandbox', 'Starter', 'month', 'pri_01m5ftaym9s2q2ea2etcgzrx1z', 2900, 'USD', 3, NULL, 14, true, true),
  ('growth_monthly_sandbox', 'paddle_sandbox', 'Growth', 'month', 'pri_01m5ftb00rqcdhg87bynxs996b', 7900, 'USD', 10, NULL, 14, true, true),
  ('pro_monthly_sandbox', 'paddle_sandbox', 'Pro', 'month', 'pri_01m5ftb1w1g1vknkyjvvr26m7x', 14900, 'USD', 30, NULL, 14, true, true)
ON CONFLICT (code) DO UPDATE SET
  provider = EXCLUDED.provider,
  display_name = EXCLUDED.display_name,
  billing_interval = EXCLUDED.billing_interval,
  provider_price_id = EXCLUDED.provider_price_id,
  amount_cents = EXCLUDED.amount_cents,
  currency_code = EXCLUDED.currency_code,
  seat_limit = EXCLUDED.seat_limit,
  ai_monthly_budget_cents = EXCLUDED.ai_monthly_budget_cents,
  trial_days = EXCLUDED.trial_days,
  is_active = EXCLUDED.is_active,
  is_development_only = EXCLUDED.is_development_only;
