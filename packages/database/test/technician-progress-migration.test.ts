import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610160001_phase4_technician_progress.sql',
    import.meta.url,
  ),
  'utf8',
);
const rpcLockMigration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610160002_lock_technician_progress_rpc.sql',
    import.meta.url,
  ),
  'utf8',
);
const lookupHardeningMigration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610160003_harden_technician_progress_lookup.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('technician field progress migration', () => {
  it('keeps work notes tenant-bound and immutable to browser roles', () => {
    expect(migration).toContain('job_work_notes_job_tenant_fk');
    expect(migration).toContain('job_work_notes_author_tenant_fk');
    expect(migration).toContain(
      'REVOKE ALL ON public.job_work_notes FROM anon, authenticated',
    );
    expect(migration).toContain(
      'GRANT SELECT ON public.job_work_notes TO authenticated',
    );
    expect(migration).not.toContain('GRANT INSERT ON public.job_work_notes');
  });

  it('locks the job and validates the assigned active technician', () => {
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain(
      'membership.id = locked_job.assigned_membership_id',
    );
    expect(migration).toContain('membership.user_id = auth.uid()');
    expect(migration).toContain("membership.role = 'technician'");
    expect(migration).toContain("membership.status = 'active'");
  });

  it('explicitly denies anonymous RPC execution', () => {
    expect(rpcLockMigration).toContain('FROM PUBLIC, anon');
    expect(rpcLockMigration).toContain('TO authenticated');
  });

  it('does not reveal whether an unassigned job UUID exists', () => {
    expect(lookupHardeningMigration).toContain(
      'JOIN public.memberships AS membership',
    );
    expect(lookupHardeningMigration).toContain(
      'membership.user_id = auth.uid()',
    );
    expect(lookupHardeningMigration).toContain('FOR UPDATE OF job');
    expect(lookupHardeningMigration).toContain(
      'assigned job not found or unavailable',
    );
    expect(lookupHardeningMigration).not.toContain(
      "RAISE EXCEPTION 'assigned job not found'",
    );
  });

  it('permits only the technician start and completion transitions', () => {
    expect(migration).toContain(
      "locked_job.status = 'scheduled' AND target_status = 'in_progress'",
    );
    expect(migration).toContain(
      "locked_job.status = 'in_progress' AND target_status = 'completed'",
    );
    expect(migration).toContain(
      'work note must be at least 3 characters or empty',
    );
    expect(migration).toContain('a completion note is required');
  });

  it('records note metadata without copying note content into the audit log', () => {
    expect(migration).toContain("'job.work_note_added'");
    expect(migration).toContain(
      "jsonb_build_object('work_note_id', work_note_id)",
    );
    expect(migration).not.toContain("jsonb_build_object('body'");
  });
});
