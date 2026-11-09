-- AI Follow-up: quote reminder email kind. Kept separate so the value is
-- committed before 202611090005 references it.

ALTER TYPE public.transactional_email_kind ADD VALUE IF NOT EXISTS 'quote_reminder';
