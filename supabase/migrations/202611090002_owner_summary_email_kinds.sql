-- AI Reporting: owner summary email kinds. Kept separate so the values are
-- committed before 202611090003 references them.

ALTER TYPE public.transactional_email_kind ADD VALUE IF NOT EXISTS 'owner_daily_summary';
ALTER TYPE public.transactional_email_kind ADD VALUE IF NOT EXISTS 'owner_weekly_summary';
