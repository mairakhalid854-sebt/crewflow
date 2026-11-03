import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function read(path: string): string {
  // Windows checkouts may use CRLF; assertions are written against LF.
  return readFileSync(
    new URL(`../../../${path}`, import.meta.url),
    'utf8',
  ).replace(/\r\n/g, '\n');
}

const migration = read(
  'supabase/migrations/202610280001_phase7_transactional_email_templates.sql',
);
const worker = read('supabase/functions/process-transactional-emails/index.js');
const configuration = read('supabase/config.toml');

describe('transactional email template migration', () => {
  it('keeps the queue and its link tokens away from browser roles', () => {
    expect(migration).toContain(
      'REVOKE ALL ON public.transactional_emails FROM anon, authenticated;',
    );
    expect(migration).toContain(
      "(status IN ('delivered', 'failed', 'cancelled') AND link_path IS NULL)",
    );
    expect(migration).toContain("position('{{link}}' IN body) > 0");
  });

  it('accepts only a verified token and derives content server-side', () => {
    expect(migration).toContain("link_token !~ '^[0-9a-f]{64}$'");
    expect(migration).toContain('quote.decision_token_hash = hashed');
    expect(migration).toContain('invoice.public_token_hash = hashed');
    expect(migration).toContain('invitation.token_hash = hashed');
    expect(migration).toContain(
      "allowed_roles := ARRAY['owner']::public.membership_role[];",
    );
    expect(migration).not.toMatch(
      /enqueue_transactional_email\([^)]*target_(subject|body|to)/,
    );
  });

  it('revalidates document and recipient state before each send', () => {
    expect(migration).toContain("quote.status = 'sent'");
    expect(migration).toContain("invoice.status IN ('sent', 'partially_paid')");
    expect(migration).toContain('invitation.revoked_at IS NULL');
    expect(migration).toContain('customer.email_suppressed_at IS NULL');
    expect(migration).toContain("'stale_email_state'");
    expect(migration).toContain('FOR UPDATE OF email SKIP LOCKED');
  });

  it('never schedules live delivery from the migration itself', () => {
    expect(migration).toContain("'crewflow-deliver-transactional-email'");
    expect(migration).not.toMatch(
      /PERFORM\s+public\.configure_transactional_email_cron\(\)/,
    );
  });
});

describe('transactional email worker', () => {
  it('builds links only from the trusted server origin', () => {
    expect(worker).toContain("Deno.env.get('CREWFLOW_WEB_APP_URL')");
    expect(worker).toContain(
      'renderLinkedBody(row.body, origin, row.link_path)',
    );
    expect(worker).toContain("idempotencyKey(delivery, 'transactional')");
    expect(worker).toContain('configured: false');
  });

  it('is registered without gateway JWT verification', () => {
    expect(configuration).toMatch(
      /\[functions\.process-transactional-emails\]\r?\nverify_jwt = false/,
    );
  });
});
