-- Weather Risk Alert: owner email kind. Kept separate so the value is
-- committed before 202611090007 references it.

ALTER TYPE public.transactional_email_kind ADD VALUE IF NOT EXISTS 'weather_risk_alert';
