import type { Database } from '@crewflow/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import {
  attemptJobPhotoUpload,
  type PendingJobPhotoUpload,
} from './job-media-upload';

function draft(
  overrides: Partial<PendingJobPhotoUpload> = {},
): PendingJobPhotoUpload {
  return {
    byteSize: 3,
    jobId: 'job-1',
    localUri: 'file:///photo.jpg',
    mediaKind: 'before',
    stored: false,
    ...overrides,
  };
}

function clientWith({
  finalizeErrors = [],
  reservationThrows = false,
  reservation,
  uploadThrows = false,
  uploadError = null,
}: Readonly<{
  finalizeErrors?: readonly (Error | null)[];
  reservationThrows?: boolean;
  reservation?: { media_id: string; storage_path: string };
  uploadError?: Error | null;
  uploadThrows?: boolean;
}>) {
  let finalizeIndex = 0;
  const rpc = vi.fn((name: string) => {
    if (name === 'reserve_assigned_job_media') {
      if (reservationThrows) throw new Error('network unavailable');
      return Promise.resolve({
        data: reservation ? [reservation] : null,
        error: reservation ? null : new Error('offline'),
      });
    }
    const error = finalizeErrors[finalizeIndex] ?? null;
    finalizeIndex += 1;
    return Promise.resolve({ data: error ? null : 'media-1', error });
  });
  const upload = vi.fn((path: string) => {
    void path;
    if (uploadThrows) throw new Error('connection reset');
    return Promise.resolve({ data: null, error: uploadError });
  });
  const client = {
    rpc,
    storage: { from: vi.fn(() => ({ upload })) },
  } as unknown as SupabaseClient<Database>;
  return { client, rpc, upload };
}

const readBytes = () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer);

describe('resumable job photo upload', () => {
  it('reserves, uploads, and finalizes a new captured photo', async () => {
    const { client, rpc, upload } = clientWith({
      finalizeErrors: [null],
      reservation: {
        media_id: 'media-1',
        storage_path: 'tenant/job/media.jpg',
      },
    });
    const onStateChange = vi.fn((nextUpload: PendingJobPhotoUpload) => {
      void nextUpload;
      return Promise.resolve();
    });

    await expect(
      attemptJobPhotoUpload(client, draft(), {
        nowMs: 1000,
        onStateChange,
        readBytes,
      }),
    ).resolves.toBe('uploaded');
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'reserve_assigned_job_media',
      'finalize_assigned_job_media',
    ]);
    expect(upload).toHaveBeenCalledOnce();
    expect(onStateChange).toHaveBeenCalledTimes(2);
    expect(onStateChange.mock.calls[0]?.[0]).toMatchObject({
      reservation: { mediaId: 'media-1' },
      stored: false,
    });
    expect(onStateChange.mock.calls[1]?.[0]).toMatchObject({ stored: true });
  });

  it('recovers an ambiguous upload error by finalizing the stored object', async () => {
    const { client, upload } = clientWith({
      finalizeErrors: [null],
      reservation: {
        media_id: 'media-1',
        storage_path: 'tenant/job/media.jpg',
      },
      uploadError: new Error('connection reset'),
    });

    await expect(
      attemptJobPhotoUpload(client, draft(), { nowMs: 1000, readBytes }),
    ).resolves.toBe('uploaded');
    expect(upload).toHaveBeenCalledOnce();
  });

  it('preserves the captured photo when authorization throws', async () => {
    const { client } = clientWith({ reservationThrows: true });

    await expect(
      attemptJobPhotoUpload(client, draft(), { readBytes }),
    ).resolves.toMatchObject({ canRetry: true, status: 'pending' });
  });

  it('preserves the reservation when storage throws and finalization cannot recover', async () => {
    const { client } = clientWith({
      finalizeErrors: [new Error('object unavailable')],
      reservation: {
        media_id: 'media-1',
        storage_path: 'tenant/job/media.jpg',
      },
      uploadThrows: true,
    });

    await expect(
      attemptJobPhotoUpload(client, draft(), { nowMs: 1000, readBytes }),
    ).resolves.toMatchObject({
      canRetry: true,
      status: 'pending',
      upload: { reservation: { mediaId: 'media-1' }, stored: false },
    });
  });

  it('retries confirmation without uploading the photo twice', async () => {
    const existingReservation = {
      mediaId: 'media-1',
      reservedAtMs: 1000,
      storagePath: 'tenant/job/media.jpg',
    };
    const firstClient = clientWith({ finalizeErrors: [new Error('offline')] });
    const firstResult = await attemptJobPhotoUpload(
      firstClient.client,
      draft({ reservation: existingReservation, stored: true }),
      { nowMs: 2000, readBytes },
    );
    expect(firstResult).toMatchObject({ status: 'pending' });
    expect(firstClient.upload).not.toHaveBeenCalled();

    const retryClient = clientWith({ finalizeErrors: [null] });
    if (firstResult === 'uploaded') throw new Error('Expected pending upload.');
    await expect(
      attemptJobPhotoUpload(retryClient.client, firstResult.upload, {
        nowMs: 3000,
        readBytes,
      }),
    ).resolves.toBe('uploaded');
    expect(retryClient.upload).not.toHaveBeenCalled();
  });

  it('renews an expired unused reservation before upload', async () => {
    const { client, rpc, upload } = clientWith({
      finalizeErrors: [new Error('not uploaded'), null],
      reservation: { media_id: 'media-2', storage_path: 'tenant/job/new.jpg' },
    });
    const result = await attemptJobPhotoUpload(
      client,
      draft({
        reservation: {
          mediaId: 'media-old',
          reservedAtMs: 0,
          storagePath: 'tenant/job/old.jpg',
        },
      }),
      { nowMs: 15 * 60 * 1000, readBytes },
    );

    expect(result).toBe('uploaded');
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'finalize_assigned_job_media',
      'reserve_assigned_job_media',
      'finalize_assigned_job_media',
    ]);
    expect(upload.mock.calls[0]?.[0]).toBe('tenant/job/new.jpg');
  });

  it('requires discard when the local cached photo no longer exists', async () => {
    const { client } = clientWith({});
    const result = await attemptJobPhotoUpload(client, draft(), {
      readBytes: () => Promise.reject(new Error('missing file')),
    });

    expect(result).toMatchObject({ canRetry: false, status: 'pending' });
  });
});
