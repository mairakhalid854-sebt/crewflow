import { describe, expect, it } from 'vitest';

import { type AsyncKeyValueStore, ChunkedStorage } from './chunked-storage';

class MemoryStore implements AsyncKeyValueStore {
  readonly values = new Map<string, string>();

  deleteItemAsync(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }

  getItemAsync(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  setItemAsync(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
}

describe('ChunkedStorage', () => {
  it('round-trips values larger than one secure-store entry', async () => {
    const store = new MemoryStore();
    const storage = new ChunkedStorage(store, 5);

    await storage.setItem('session', 'crewflow-session-token');

    await expect(storage.getItem('session')).resolves.toBe(
      'crewflow-session-token',
    );
    expect(store.values.size).toBeGreaterThan(2);
  });

  it('removes stale chunks when a value gets shorter', async () => {
    const store = new MemoryStore();
    const storage = new ChunkedStorage(store, 4);

    await storage.setItem('session', 'a-long-session-value');
    await storage.setItem('session', 'short');

    await expect(storage.getItem('session')).resolves.toBe('short');
    expect([...store.values.keys()]).not.toContain('session.chunk.2');
  });

  it('fails closed and clears an incomplete session', async () => {
    const store = new MemoryStore();
    const storage = new ChunkedStorage(store, 4);

    await storage.setItem('session', 'session-value');
    await store.deleteItemAsync('session.chunk.1');

    await expect(storage.getItem('session')).resolves.toBeNull();
    expect(store.values.size).toBe(0);
  });
});
