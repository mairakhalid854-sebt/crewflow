import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610160004_phase4_job_media.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('private job media migration', () => {
  it('creates a private JPEG-only bucket with a five MB limit', () => {
    expect(migration).toContain("'job-media'");
    expect(migration).toContain('public = false');
    expect(migration).toContain('5242880');
    expect(migration).toContain("ARRAY['image/jpeg']");
  });

  it('binds every photo to the same tenant job and uploader', () => {
    expect(migration).toContain('job_media_job_tenant_fk');
    expect(migration).toContain('job_media_uploader_tenant_fk');
    expect(migration).toContain('media.uploader_membership_id = membership.id');
    expect(migration).toContain('membership.user_id = auth.uid()');
  });

  it('uses a guarded reserve, upload, and finalize lifecycle', () => {
    expect(migration).toContain('reserve_assigned_job_media');
    expect(migration).toContain('finalize_assigned_job_media');
    expect(migration).toContain('FOR UPDATE OF job');
    expect(migration).toContain('FOR UPDATE OF media');
    expect(migration).toContain('uploaded_at IS NULL');
    expect(migration).toContain('uploaded_at IS NOT NULL');
  });

  it('does not grant browser roles direct mutation access', () => {
    expect(migration).toContain(
      'REVOKE ALL ON public.job_media FROM anon, authenticated',
    );
    expect(migration).toContain(
      'GRANT SELECT ON public.job_media TO authenticated',
    );
    expect(migration).not.toContain('GRANT INSERT ON public.job_media');
    expect(migration).not.toContain('GRANT UPDATE ON public.job_media');
  });

  it('keeps raw storage objects private and auditable', () => {
    expect(migration).toContain('job_media_objects_insert_assigned_technician');
    expect(migration).toContain('job_media_objects_read_authorized');
    expect(migration).toContain("'job.photo_uploaded'");
    expect(migration).not.toContain('getPublicUrl');
  });

  it('denies anonymous command execution explicitly', () => {
    expect(migration.match(/FROM PUBLIC, anon/g)).toHaveLength(2);
  });
});
