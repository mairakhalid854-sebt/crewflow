import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610180001_cleanup_expired_job_media.sql',
    import.meta.url,
  ),
  'utf8',
);
const edgeFunction = readFileSync(
  new URL(
    '../../../supabase/functions/cleanup-job-media/index.js',
    import.meta.url,
  ),
  'utf8',
);

describe('expired job media cleanup', () => {
  it('claims only old, unfinalized reservations in bounded batches', () => {
    expect(migration).toContain("now() - interval '7 days'");
    expect(migration).toContain('media.uploaded_at IS NULL');
    expect(migration).toContain('LIMIT batch_size');
    expect(migration).toContain('FOR UPDATE SKIP LOCKED');
    expect(migration).toContain('batch_size NOT BETWEEN 1 AND 500');
  });

  it('uses a retryable lease and prevents finalization after a cleanup claim', () => {
    expect(migration).toContain("now() - interval '15 minutes'");
    expect(migration).toContain('cleanup_claimed_at = now()');
    expect(migration).toContain('guard_claimed_job_media_finalization');
    expect(migration).toContain('job photo reservation is being cleaned up');
  });

  it('keeps cleanup commands inaccessible to browser roles', () => {
    expect(migration.match(/TO service_role/g)).toHaveLength(2);
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).not.toContain('TO authenticated;');
  });

  it('deletes physical objects through the Storage API before metadata', () => {
    const storageRemoval = edgeFunction.indexOf('.remove(storagePaths)');
    const metadataCompletion = edgeFunction.indexOf(
      "'complete_expired_job_media_cleanup'",
    );

    expect(storageRemoval).toBeGreaterThan(-1);
    expect(metadataCompletion).toBeGreaterThan(storageRemoval);
    expect(edgeFunction).not.toContain('DELETE FROM storage.objects');
  });

  it('requires a secret key and limits each invocation', () => {
    expect(edgeFunction).toContain("request.headers.get('apikey')");
    expect(edgeFunction).toContain("'SUPABASE_SECRET_KEYS'");
    expect(edgeFunction).toContain('const BATCH_SIZE = 100');
  });
});
