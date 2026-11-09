import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const kinds = readFileSync(
  new URL(
    '../../../supabase/migrations/202611090002_owner_summary_email_kinds.sql',
    import.meta.url,
  ),
  'utf8',
);
const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202611090003_ai_owner_summaries.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('AI owner summaries migration', () => {
  it('adds the email kinds in their own migration', () => {
    expect(kinds).toContain("ADD VALUE IF NOT EXISTS 'owner_daily_summary'");
    expect(kinds).toContain("ADD VALUE IF NOT EXISTS 'owner_weekly_summary'");
    expect(migration).not.toContain('ALTER TYPE');
  });

  it('keeps both summaries off by default', () => {
    expect(migration).toContain(
      'owner_daily_summary_enabled boolean NOT NULL DEFAULT false',
    );
    expect(migration).toContain(
      'owner_weekly_summary_enabled boolean NOT NULL DEFAULT false',
    );
  });

  it('computes figures with SQL, not a language model', () => {
    expect(migration).toContain('CREATE FUNCTION public.build_owner_summary');
    expect(migration).toContain('sum(payment.amount_cents)');
    expect(migration).toContain("payment.record_type = 'payment'");
    expect(migration).not.toContain('net.http_post');
    expect(migration).not.toMatch(/openai|gpt-/i);
  });

  it('sends once per owner per local day at 7 AM, weekly on Monday', () => {
    expect(migration).toContain('extract(hour FROM local_now) <> 7');
    expect(migration).toContain('extract(isodow FROM local_now) <> 1');
    expect(migration).toContain(
      'ON CONFLICT (tenant_id, kind, token_hash) DO NOTHING',
    );
    expect(migration).toContain("membership.role = 'owner'");
    expect(migration).toContain("'crewflow-owner-summaries'");
  });

  it('cancels unsent summaries when turned off and keeps workers private', () => {
    expect(migration).toContain(
      "WHEN 'owner_daily_summary' THEN public.owner_summary_email_is_current(",
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.queue_owner_summaries(timestamptz) TO service_role',
    );
    expect(migration).toContain('only an active owner can preview summaries');
  });
});
