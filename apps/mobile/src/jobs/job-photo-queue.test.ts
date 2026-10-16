import { describe, expect, it } from 'vitest';

import {
  type DurablePhotoFileStore,
  JobPhotoQueue,
  type PhotoQueueMetadataStore,
} from './job-photo-queue';

class MemoryMetadata implements PhotoQueueMetadataStore {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  removeItem(key: string) {
    this.values.delete(key);
    return Promise.resolve();
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
    return Promise.resolve();
  }
}

class MemoryFiles implements DurablePhotoFileStore {
  readonly files = new Map<string, string>();
  private sequence = 0;

  copy(userId: string, sourceUri: string) {
    this.sequence += 1;
    const uri = `file:///durable/${userId}/${this.sequence}.jpg`;
    this.files.set(uri, sourceUri);
    return Promise.resolve(uri);
  }

  exists(uri: string) {
    return Promise.resolve(this.files.has(uri));
  }

  remove(_userId: string, uri: string) {
    this.files.delete(uri);
    return Promise.resolve();
  }

  removeUnreferenced(userId: string, referencedUris: ReadonlySet<string>) {
    const prefix = `file:///durable/${userId}/`;
    for (const uri of this.files.keys()) {
      if (uri.startsWith(prefix) && !referencedUris.has(uri)) {
        this.files.delete(uri);
      }
    }
    return Promise.resolve();
  }
}

const userId = '11111111-1111-4111-8111-111111111111';

function captured(jobId = 'job-1') {
  return {
    byteSize: 3,
    jobId,
    localUri: 'file:///cache/captured.jpg',
    mediaKind: 'before' as const,
    stored: false,
  };
}

describe('durable job photo queue', () => {
  it('restores a staged photo after a new queue instance starts', async () => {
    const metadata = new MemoryMetadata();
    const files = new MemoryFiles();
    const firstSession = new JobPhotoQueue(metadata, files, {
      now: () => 1000,
    });
    const upload = await firstSession.stage(userId, captured());

    const restartedSession = new JobPhotoQueue(metadata, files, {
      now: () => 2000,
    });
    await expect(restartedSession.load(userId)).resolves.toEqual([
      expect.objectContaining({
        canRetry: true,
        status: 'pending',
        upload,
      }),
    ]);
    expect(upload.localUri).toContain(`/durable/${userId}/`);
  });

  it('keeps pending photos isolated by authenticated user', async () => {
    const metadata = new MemoryMetadata();
    const files = new MemoryFiles();
    const queue = new JobPhotoQueue(metadata, files);
    await queue.stage(userId, captured());

    await expect(
      queue.load('22222222-2222-4222-8222-222222222222'),
    ).resolves.toEqual([]);
    await expect(queue.load(userId)).resolves.toHaveLength(1);
  });

  it('persists reservation and storage progress for idempotent recovery', async () => {
    const metadata = new MemoryMetadata();
    const files = new MemoryFiles();
    const queue = new JobPhotoQueue(metadata, files, { now: () => 1000 });
    const upload = await queue.stage(userId, captured());
    await queue.saveUpload(userId, {
      ...upload,
      reservation: {
        mediaId: 'media-1',
        reservedAtMs: 1000,
        storagePath: 'tenant/job/media.jpg',
      },
      stored: true,
    });

    const restored = await queue.load(userId);
    expect(restored).toHaveLength(1);
    expect(restored[0]?.canRetry).toBe(true);
    expect(restored[0]?.message).toContain('confirmation');
    expect(restored[0]?.upload.stored).toBe(true);
  });

  it('requires discard when an unstored durable file is missing', async () => {
    const metadata = new MemoryMetadata();
    const files = new MemoryFiles();
    const queue = new JobPhotoQueue(metadata, files);
    const upload = await queue.stage(userId, captured());
    files.files.delete(upload.localUri);

    await expect(queue.load(userId)).resolves.toEqual([
      expect.objectContaining({ canRetry: false, status: 'pending' }),
    ]);
  });

  it('removes queue metadata and the durable image after completion or discard', async () => {
    const metadata = new MemoryMetadata();
    const files = new MemoryFiles();
    const queue = new JobPhotoQueue(metadata, files);
    const upload = await queue.stage(userId, captured());

    await queue.remove(userId, upload);

    await expect(queue.load(userId)).resolves.toEqual([]);
    expect(files.files.has(upload.localUri)).toBe(false);
    expect(metadata.values.size).toBe(0);
  });

  it('expires week-old photos and removes unreferenced account files', async () => {
    let now = 1000;
    const metadata = new MemoryMetadata();
    const files = new MemoryFiles();
    const queue = new JobPhotoQueue(metadata, files, { now: () => now });
    await queue.stage(userId, captured());
    files.files.set(`file:///durable/${userId}/orphan.jpg`, 'orphan');
    now += 8 * 24 * 60 * 60 * 1000;

    await expect(queue.load(userId)).resolves.toEqual([]);
    expect(files.files.size).toBe(0);
  });

  it('clears malformed metadata and its account-scoped orphan files', async () => {
    const metadata = new MemoryMetadata();
    const files = new MemoryFiles();
    metadata.values.set(
      `crewflow.pending-job-photos.v1.${userId}`,
      '{"version":1,"entries":"invalid"}',
    );
    files.files.set(`file:///durable/${userId}/orphan.jpg`, 'orphan');
    const queue = new JobPhotoQueue(metadata, files);

    await expect(queue.load(userId)).resolves.toEqual([]);
    expect(metadata.values.size).toBe(0);
    expect(files.files.size).toBe(0);
  });
});
