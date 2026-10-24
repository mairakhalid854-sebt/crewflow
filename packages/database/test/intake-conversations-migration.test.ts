import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610240003_phase6_intake_conversations.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('phase 6 intake conversation persistence', () => {
  it('stores only a SHA-256 digest of the public session token', () => {
    expect(migration).toContain('session_token_hash text NOT NULL UNIQUE');
    expect(migration).toContain(
      "extensions.digest(pg_catalog.convert_to(session_token, 'UTF8'), 'sha256')",
    );
    expect(migration).not.toContain('session_token text NOT NULL');
  });

  it('binds conversations and messages to one tenant', () => {
    expect(migration).toContain('intake_conversations_id_tenant_unique');
    expect(migration).toContain('intake_messages_conversation_tenant_fk');
    expect(migration).toContain(
      'REFERENCES public.intake_conversations(id, tenant_id)',
    );
  });

  it('freezes a bounded enabled-service catalog for deterministic matching', () => {
    expect(migration).toContain('catalog_snapshot jsonb NOT NULL');
    expect(migration).toContain('jsonb_array_length(catalog_snapshot) <= 100');
    expect(migration).toContain('service.is_enabled');
    expect(migration).toContain('service.archived_at IS NULL');
    expect(migration).toContain(
      'selected service is outside the catalog snapshot',
    );
  });

  it('keeps anonymous clients behind the service boundary', () => {
    expect(migration).toContain(
      'CREATE FUNCTION public.open_intake_conversation',
    );
    expect(migration).toContain('CREATE FUNCTION public.record_intake_turn');
    expect(migration).toContain("auth.role() IS DISTINCT FROM 'service_role'");
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).not.toMatch(
      /GRANT (SELECT|INSERT|UPDATE|DELETE).* TO anon/,
    );
  });

  it('limits session lifetime, message size, and turn count', () => {
    expect(migration).toContain("now() + interval '24 hours'");
    expect(migration).toContain(
      "expires_at <= created_at + interval '24 hours'",
    );
    expect(migration).toContain('char_length(body) BETWEEN 1 AND 4000');
    expect(migration).toContain('sequence_number BETWEEN 1 AND 1000');
  });

  it('makes transcripts immutable and human takeover auditable', () => {
    expect(migration).toContain('intake_messages_immutable');
    expect(migration).toContain('Intake messages are immutable');
    expect(migration).toContain(
      'CREATE FUNCTION public.take_over_intake_conversation',
    );
    expect(migration).toContain("'ai.intake_human_takeover'");
  });
});
