import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610160005_phase4_job_signatures.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('customer job signatures migration', () => {
  it('binds each immutable signature to its tenant job and capturer', () => {
    expect(migration).toContain('job_signatures_job_tenant_fk');
    expect(migration).toContain('job_signatures_capturer_tenant_fk');
    expect(migration).toContain('job_signatures_one_per_job');
    expect(migration).toContain('captured_by_membership_id');
  });

  it('requires the exact consent, signer identity, and bounded stroke data', () => {
    expect(migration).toContain(
      'accepted_consent_text IS DISTINCT FROM required_consent',
    );
    expect(migration).toContain('normalized_signer_name');
    expect(migration).toContain(
      'jsonb_array_length(signature_strokes) NOT BETWEEN 1 AND 40',
    );
    expect(migration).toContain('point_x NOT BETWEEN 0 AND 1');
    expect(migration).toContain('point_y NOT BETWEEN 0 AND 1');
  });

  it('locks and rechecks the live assignment before recording', () => {
    expect(migration).toContain('FOR UPDATE OF job');
    expect(migration).toContain("membership.role = 'technician'");
    expect(migration).toContain("membership.status = 'active'");
    expect(migration).toContain("locked_job.status <> 'in_progress'");
  });

  it('creates tamper evidence and an immutable audit event', () => {
    expect(migration).toContain('extensions.digest(');
    expect(migration).toContain("'sha256'");
    expect(migration).toContain("'job.customer_signature_recorded'");
    expect(migration).toContain('signature_integrity_hash');
  });

  it('does not grant browser roles direct mutation access', () => {
    expect(migration).toContain(
      'REVOKE ALL ON public.job_signatures FROM anon, authenticated',
    );
    expect(migration).toContain(
      'GRANT SELECT ON public.job_signatures TO authenticated',
    );
    expect(migration).not.toContain('GRANT INSERT ON public.job_signatures');
    expect(migration).not.toContain('GRANT UPDATE ON public.job_signatures');
    expect(migration).not.toContain('GRANT DELETE ON public.job_signatures');
  });

  it('denies anonymous command execution explicitly', () => {
    expect(migration).toContain('FROM PUBLIC, anon');
  });
});
