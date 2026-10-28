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
  'supabase/migrations/202610280004_phase7_marketing_unsubscribe.sql',
);
const worker = read(
  'supabase/functions/process-follow-up-email-deliveries/index.js',
);

describe('marketing unsubscribe migration', () => {
  it('signs links with a Vault key instead of storing tokens', () => {
    expect(migration).toContain("'crewflow_unsubscribe_signing_key'");
    expect(migration).toContain('extensions.hmac(');
    expect(migration).not.toMatch(/ADD COLUMN\s+\w*unsubscribe\w*/i);
  });

  it('keeps signing helpers private and exposes only the opt-out RPCs', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.marketing_unsubscribe_signature(uuid)\n  FROM PUBLIC, anon, authenticated;',
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.verified_unsubscribe_customer(text)\n  FROM PUBLIC, anon, authenticated;',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.unsubscribe_marketing_email(text)\n  TO anon, authenticated;',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.claim_follow_up_email_deliveries(integer, boolean)\n  TO service_role;',
    );
  });

  it('holds marketing mail unless requested and addressed', () => {
    expect(migration).toContain('include_marketing boolean DEFAULT false');
    expect(migration).toContain(
      'nullif(btrim(tenant.street_address), \x27\x27) IS NOT NULL',
    );
    expect(migration).toContain('OR NOT customer.marketing_email_opted_in');
  });
});

describe('Follow-Up worker marketing switch', () => {
  it('enables marketing only by explicit operator switch', () => {
    expect(worker).toContain(
      "Deno.env.get('CREWFLOW_MARKETING_EMAIL_ENABLED') === 'true'",
    );
    expect(worker).toContain('prepareMarketingEmail(');
    expect(worker).toContain("'marketing_footer_unavailable'");
  });
});
