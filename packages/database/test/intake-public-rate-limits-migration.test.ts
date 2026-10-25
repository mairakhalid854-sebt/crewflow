import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610250001_phase6_intake_public_rate_limits.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('public Intake database rate limits', () => {
  it('serializes and limits new conversations per tenant', () => {
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain("now() - interval '1 minute'");
    expect(migration).toContain('>= 20');
    expect(migration).toContain('intake conversation rate limit exceeded');
  });

  it('limits message bursts per conversation', () => {
    expect(migration).toContain('intake_messages_rate_limit');
    expect(migration).toContain('>= 40');
    expect(migration).toContain('intake message rate limit exceeded');
  });

  it('retains rejected turns without allowing state changes', () => {
    expect(migration).toContain(
      'CREATE FUNCTION public.record_intake_validation_error',
    );
    expect(migration).toContain("conversation.status <> 'collecting'");
    expect(migration).toContain(
      'SET last_message_at = now(), version = version + 1',
    );
    expect(migration).not.toContain('SET stage =');
  });

  it('keeps validation writes behind the service boundary', () => {
    expect(migration).toContain("auth.role() IS DISTINCT FROM 'service_role'");
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('TO service_role');
  });
});
