-- CrewFlow: the owner set a 7-day free trial for new subscriptions. Paddle
-- applies the trial from each price; run scripts/configure-paddle-sandbox.mjs
-- to update the sandbox prices in place so this displayed value matches.
-- Existing subscriptions keep the trial they started with.

UPDATE public.billing_plans
SET trial_days = 7
WHERE provider = 'paddle_sandbox'
  AND code IN (
    'starter_monthly_sandbox',
    'growth_monthly_sandbox',
    'pro_monthly_sandbox'
  );
