-- CrewFlow Phase 7: work-report link email kind. Kept separate so the value
-- is committed before 202610280003 references it.

ALTER TYPE public.transactional_email_kind ADD VALUE IF NOT EXISTS 'work_report';
