-- CrewFlow Phase 7: customer appointment email kinds. Kept separate so the
-- values are committed before 202610280007 references them.

ALTER TYPE public.transactional_email_kind ADD VALUE IF NOT EXISTS 'job_scheduled';
ALTER TYPE public.transactional_email_kind ADD VALUE IF NOT EXISTS 'job_rescheduled';
ALTER TYPE public.transactional_email_kind ADD VALUE IF NOT EXISTS 'job_cancelled';
