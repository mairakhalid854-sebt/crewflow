-- AI Round 2: agent kinds for the quote assistant and note translation.
-- Kept separate so the values are committed before 202611100002 uses them.

ALTER TYPE public.ai_agent_kind ADD VALUE IF NOT EXISTS 'quote_assistant';
ALTER TYPE public.ai_agent_kind ADD VALUE IF NOT EXISTS 'translation';
