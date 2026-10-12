import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610120002_phase1_team_invitations.sql',
    import.meta.url,
  ),
  'utf8',
);

const teamTables = [
  'team_invitations',
  'staff_profiles',
  'staff_availability',
] as const;

describe('Phase 1 team migration', () => {
  it.each(teamTables)('enables RLS for %s', (table) => {
    expect(migration).toContain(
      `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`,
    );
  });

  it('persists only hashed invitation tokens', () => {
    expect(migration).toContain('token_hash text NOT NULL UNIQUE');
    expect(migration).toContain('extensions.digest');
    expect(migration).not.toMatch(/invitation_token text NOT NULL/);
  });

  it('requires a matching verified email when accepting an invitation', () => {
    expect(migration).toContain('auth_user.email_confirmed_at IS NOT NULL');
    expect(migration).toContain('target_invitation.email <> current_email');
  });

  it('prevents direct membership mutations by authenticated clients', () => {
    expect(migration).toContain(
      'REVOKE INSERT, UPDATE ON public.memberships FROM authenticated;',
    );
    expect(migration).toContain('DROP POLICY memberships_insert_owner');
    expect(migration).toContain('DROP POLICY memberships_update_owner');
  });

  it('protects the last active owner and self-deactivation', () => {
    expect(migration).toContain(
      'the workspace must keep at least one active owner',
    );
    expect(migration).toContain('owners cannot deactivate their own account');
  });

  it('does not grant direct writes to team tables', () => {
    expect(migration).toContain(
      'GRANT SELECT ON public.team_invitations TO authenticated;',
    );
    expect(migration).toContain(
      'GRANT SELECT ON public.staff_profiles TO authenticated;',
    );
    expect(migration).not.toMatch(
      /GRANT .*INSERT.* ON public\.(team_invitations|staff_profiles|staff_availability)/,
    );
  });

  it('adds audit triggers for customer and service mutations', () => {
    expect(migration).toContain('CREATE TRIGGER customers_record_audit');
    expect(migration).toContain('CREATE TRIGGER services_record_audit');
  });
});
