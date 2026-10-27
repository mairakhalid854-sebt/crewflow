import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
}

const migration = read(
  'supabase/migrations/202610270005_phase7_follow_up_email_delivery.sql',
);
const worker = read(
  'supabase/functions/process-follow-up-email-deliveries/index.js',
);
const webhook = read('supabase/functions/resend-email-webhook/index.js');
const configuration = read('supabase/config.toml');

describe('Follow-Up email delivery migration', () => {
  it('claims only transactional messages under bounded leases', () => {
    expect(migration).toContain("message.category = 'transactional'");
    expect(migration).toContain('message.attempt_count < 5');
    expect(migration).toContain("interval '2 minutes'");
    expect(migration).toContain('FOR UPDATE OF message SKIP LOCKED');
    expect(migration).toContain('target_batch_size NOT BETWEEN 1 AND 25');
    expect(migration).not.toMatch(/category\s*=\s*'marketing'/);
  });

  it('revalidates contact and invoice state before sending', () => {
    expect(migration).toContain('customer.email_suppressed_at IS NOT NULL');
    expect(migration).toContain('NOT customer.transactional_email_allowed');
    expect(migration).toContain(
      'lower(customer.email) IS DISTINCT FROM message.to_email',
    );
    expect(migration).toContain('invoice.paid_cents >= invoice.total_cents');
    expect(migration).toContain("'stale_follow_up_state'");
  });

  it('restricts every function to the service role', () => {
    for (const signature of [
      'claim_follow_up_email_deliveries(integer)',
      'complete_follow_up_email_delivery(uuid, uuid, text)',
      'retry_follow_up_email_delivery(uuid, uuid, text, boolean)',
      'record_provider_email_suppression(text, text)',
      'configure_follow_up_email_delivery_cron()',
    ]) {
      expect(migration).toContain(
        `REVOKE ALL ON FUNCTION public.${signature}\n  FROM PUBLIC, anon, authenticated;`,
      );
      expect(migration).toContain(
        `GRANT EXECUTE ON FUNCTION public.${signature}\n  TO service_role;`,
      );
    }
  });

  it('never schedules live delivery from the migration itself', () => {
    expect(migration).toContain("'crewflow-deliver-follow-up-email'");
    expect(migration).not.toMatch(
      /PERFORM\s+public\.configure_follow_up_email_delivery_cron\(\)/,
    );
  });
});

describe('Follow-Up email edge functions', () => {
  it('keeps provider credentials server-side and idempotent', () => {
    expect(worker).toContain("Deno.env.get('RESEND_API_KEY')");
    expect(worker).toContain("'idempotency-key': idempotencyKey(delivery)");
    expect(worker).toContain('configured: false');
    expect(worker).not.toMatch(
      /console\.(log|error)\([^)]*(apiKey|body|to_email)/,
    );
  });

  it('verifies webhook signatures before touching the database', () => {
    const verifyIndex = webhook.indexOf('verifyResendWebhook(');
    const rpcIndex = webhook.indexOf("'record_provider_email_suppression'");
    expect(verifyIndex).toBeGreaterThan(-1);
    expect(rpcIndex).toBeGreaterThan(verifyIndex);
    expect(webhook).toContain("Deno.env.get('RESEND_WEBHOOK_SECRET')");
    expect(webhook).toContain('MAX_BODY_BYTES');
  });

  it('registers both functions without gateway JWT verification', () => {
    expect(configuration).toMatch(
      /\[functions\.process-follow-up-email-deliveries\]\r?\nverify_jwt = false/,
    );
    expect(configuration).toMatch(
      /\[functions\.resend-email-webhook\]\r?\nverify_jwt = false/,
    );
  });
});
