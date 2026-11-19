-- Weather campaigns: owner notice email kind. Kept separate so the value is
-- committed before 202611180006 references it.

ALTER TYPE public.transactional_email_kind ADD VALUE IF NOT EXISTS 'weather_campaign_ready';
