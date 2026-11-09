import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const kind = readFileSync(
  new URL(
    '../../../supabase/migrations/202611090004_quote_reminder_email_kind.sql',
    import.meta.url,
  ),
  'utf8',
);
const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202611090005_ai_quote_follow_ups.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('AI quote follow-ups migration', () => {
  it('adds the email kind in its own migration and keeps reminders off', () => {
    expect(kind).toContain("ADD VALUE IF NOT EXISTS 'quote_reminder'");
    expect(migration).not.toContain('ALTER TYPE');
    expect(migration).toContain(
      'quote_follow_up_emails_enabled boolean NOT NULL DEFAULT false',
    );
  });

  it('only reminds open quotes on day 3 and day 7 at 10 AM local', () => {
    expect(migration).toContain("quote.status = 'sent'");
    expect(migration).toContain('quote.expires_at > target_now');
    expect(migration).toContain('days_waiting NOT IN (3, 7)');
    expect(migration).toContain(
      'extract(hour FROM target_now AT TIME ZONE tenant.time_zone) = 10',
    );
  });

  it('respects customer email consent and suppression', () => {
    expect(migration).toContain('customer.email_suppressed_at IS NULL');
    expect(migration).toContain('customer.transactional_email_allowed');
  });

  it('never re-issues the quote link and never duplicates a reminder', () => {
    expect(migration).not.toContain('UPDATE public.quotes');
    expect(migration).toContain(
      'ON CONFLICT (tenant_id, kind, token_hash) DO NOTHING',
    );
    expect(migration).toContain(
      "WHEN 'quote_reminder' THEN public.quote_reminder_email_is_current(",
    );
  });

  it('keeps the scheduler service-only', () => {
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.queue_quote_follow_ups(timestamptz) TO service_role',
    );
    expect(migration).toContain("'crewflow-quote-follow-ups'");
  });
});
