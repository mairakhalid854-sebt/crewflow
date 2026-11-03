import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610130002_personal_profile_sync.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Personal profile synchronization migration', () => {
  it('runs only after authenticated metadata updates', () => {
    expect(migration).toContain(
      'AFTER UPDATE OF raw_user_meta_data ON auth.users',
    );
    expect(migration).toContain(
      'normalized_full_name IS NOT DISTINCT FROM old_full_name',
    );
  });

  it('validates the user-controlled display name', () => {
    expect(migration).toContain(
      'char_length(normalized_full_name) NOT BETWEEN 2 AND 120',
    );
    expect(migration).toContain("ERRCODE = '22023'");
  });

  it('synchronizes profile and active staff records', () => {
    expect(migration).toContain('INSERT INTO public.profiles');
    expect(migration).toContain('UPDATE public.staff_profiles');
    expect(migration).toContain("membership.status = 'active'");
  });

  it('records a tenant audit event without storing name values', () => {
    expect(migration).toContain("'profile.updated'");
    expect(migration).not.toContain('jsonb_build_object');
  });
});
