import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610250002_audit_intake_widget_settings.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Intake widget setting audit', () => {
  it('audits only public Intake setting changes', () => {
    expect(migration).toContain(
      'AFTER UPDATE OF intake_widget_enabled, intake_widget_key',
    );
    expect(migration).toContain('IS DISTINCT FROM OLD.intake_widget_enabled');
    expect(migration).toContain('IS DISTINCT FROM OLD.intake_widget_key');
  });

  it('records enablement, disablement, and key rotation metadata', () => {
    expect(migration).toContain("'ai.intake_widget_enabled'");
    expect(migration).toContain("'ai.intake_widget_disabled'");
    expect(migration).toContain("'key_changed'");
    expect(migration).toContain('auth.uid()');
  });

  it('does not expose the trigger function as a callable API', () => {
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
  });
});
