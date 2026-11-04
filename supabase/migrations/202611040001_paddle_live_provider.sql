-- Adds the live Paddle billing provider. The enum value is committed in its own
-- migration because PostgreSQL cannot use a new enum value in the transaction
-- that adds it. 202611040002 wires the provider into plans, events, and
-- reconciliation.

ALTER TYPE public.billing_provider ADD VALUE IF NOT EXISTS 'paddle';
