import { describe, expect, it } from 'vitest';

import {
  type JobProgressDraft,
  JobProgressDraftStore,
  type ProgressDraftStorage,
  progressDraftHasConflict,
} from './job-progress-draft-queue';

class MemoryStorage implements ProgressDraftStorage {
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

const savedAt = new Date('2026-10-19T12:00:00.000Z');
const input = {
  baseJobUpdatedAt: '2026-10-19T11:00:00.000Z',
  jobId: 'job-a',
  note: 'Completed diagnostic checks.',
  targetStatus: 'completed' as const,
  userId: 'user-a',
};

describe('job progress drafts', () => {
  it('persists, restores, replaces, and removes an account-scoped draft', async () => {
    const storage = new MemoryStorage();
    const store = new JobProgressDraftStore(storage, () => savedAt);

    await store.save(input);
    expect(await store.get('user-a', 'job-a')).toMatchObject(input);

    await store.save({ ...input, note: 'Updated completion details.' });
    expect((await store.get('user-a', 'job-a'))?.note).toBe(
      'Updated completion details.',
    );
    expect(await store.get('user-b', 'job-a')).toBeUndefined();

    await store.remove('user-a', 'job-a');
    expect(await store.get('user-a', 'job-a')).toBeUndefined();
  });

  it('drops malformed, cross-account, and expired draft data', async () => {
    const storage = new MemoryStorage();
    const key = 'crewflow.mobile.progress-drafts.v1.user-a';
    storage.values.set(
      key,
      JSON.stringify([
        { ...input, savedAt: savedAt.toISOString(), version: 1 },
        {
          ...input,
          jobId: 'other-user-job',
          savedAt: savedAt.toISOString(),
          userId: 'user-b',
          version: 1,
        },
        {
          ...input,
          jobId: 'expired-job',
          savedAt: '2026-10-01T12:00:00.000Z',
          version: 1,
        },
        { invalid: true },
      ]),
    );
    const store = new JobProgressDraftStore(storage, () => savedAt);

    expect(await store.get('user-a', 'job-a')).toBeDefined();
    expect(await store.get('user-a', 'expired-job')).toBeUndefined();
    expect(JSON.parse(storage.values.get(key) ?? '[]')).toHaveLength(1);
  });

  it('caps notes and the number of drafts retained per account', async () => {
    const storage = new MemoryStorage();
    const store = new JobProgressDraftStore(storage, () => savedAt);

    await expect(
      store.save({ ...input, note: 'x'.repeat(2001) }),
    ).rejects.toThrow('2,000');
    for (let index = 0; index < 52; index += 1) {
      await store.save({ ...input, jobId: `job-${index}` });
    }
    const stored = [...storage.values.values()][0];
    expect(JSON.parse(stored ?? '[]')).toHaveLength(50);
  });

  it('serializes a pending save before a later discard', async () => {
    const storage = new MemoryStorage();
    const store = new JobProgressDraftStore(storage, () => savedAt);

    const saving = store.save(input);
    const removing = store.remove('user-a', 'job-a');
    await Promise.all([saving, removing]);

    expect(await store.get('user-a', 'job-a')).toBeUndefined();
  });

  it('requires explicit review after the job or intended transition changes', () => {
    const draft: JobProgressDraft = {
      ...input,
      savedAt: savedAt.toISOString(),
      version: 1,
    };
    expect(
      progressDraftHasConflict(draft, '2026-10-19T11:00:00.000Z', 'completed'),
    ).toBe(false);
    expect(
      progressDraftHasConflict(draft, '2026-10-19T11:30:00.000Z', 'completed'),
    ).toBe(true);
    expect(
      progressDraftHasConflict(
        draft,
        '2026-10-19T11:00:00.000Z',
        'in_progress',
      ),
    ).toBe(true);
  });
});
