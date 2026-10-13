const DEFAULT_CHUNK_SIZE = 1_800;
const MANIFEST_VERSION = 1;

interface ChunkManifest {
  readonly chunks: number;
  readonly version: typeof MANIFEST_VERSION;
}

export interface AsyncKeyValueStore {
  deleteItemAsync(key: string): Promise<void>;
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
}

export class ChunkedStorage {
  constructor(
    private readonly store: AsyncKeyValueStore,
    private readonly chunkSize = DEFAULT_CHUNK_SIZE,
  ) {
    if (!Number.isInteger(chunkSize) || chunkSize < 1) {
      throw new Error('chunkSize must be a positive integer');
    }
  }

  async getItem(key: string): Promise<string | null> {
    const manifest = await this.readManifest(key);
    if (!manifest) return null;

    const chunks = await Promise.all(
      Array.from({ length: manifest.chunks }, (_, index) =>
        this.store.getItemAsync(this.chunkKey(key, index)),
      ),
    );

    if (chunks.some((chunk) => chunk === null)) {
      await this.removeItem(key);
      return null;
    }

    return chunks.join('');
  }

  async removeItem(key: string): Promise<void> {
    const manifest = await this.readManifest(key);
    if (manifest) {
      await Promise.all(
        Array.from({ length: manifest.chunks }, (_, index) =>
          this.store.deleteItemAsync(this.chunkKey(key, index)),
        ),
      );
    }

    await this.store.deleteItemAsync(this.manifestKey(key));
  }

  async setItem(key: string, value: string): Promise<void> {
    const previousManifest = await this.readManifest(key);
    const chunks = this.split(value);

    await Promise.all(
      chunks.map((chunk, index) =>
        this.store.setItemAsync(this.chunkKey(key, index), chunk),
      ),
    );
    await this.store.setItemAsync(
      this.manifestKey(key),
      JSON.stringify({ chunks: chunks.length, version: MANIFEST_VERSION }),
    );

    if (previousManifest && previousManifest.chunks > chunks.length) {
      await Promise.all(
        Array.from(
          { length: previousManifest.chunks - chunks.length },
          (_, offset) =>
            this.store.deleteItemAsync(
              this.chunkKey(key, chunks.length + offset),
            ),
        ),
      );
    }
  }

  private chunkKey(key: string, index: number): string {
    return `${key}.chunk.${index}`;
  }

  private manifestKey(key: string): string {
    return `${key}.manifest`;
  }

  private async readManifest(key: string): Promise<ChunkManifest | null> {
    const stored = await this.store.getItemAsync(this.manifestKey(key));
    if (!stored) return null;

    try {
      const parsed: unknown = JSON.parse(stored);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'chunks' in parsed &&
        'version' in parsed &&
        Number.isInteger(parsed.chunks) &&
        typeof parsed.chunks === 'number' &&
        parsed.chunks > 0 &&
        parsed.version === MANIFEST_VERSION
      ) {
        return { chunks: parsed.chunks, version: MANIFEST_VERSION };
      }
    } catch {
      // Invalid manifests are treated as an absent session.
    }

    await this.store.deleteItemAsync(this.manifestKey(key));
    return null;
  }

  private split(value: string): string[] {
    if (value.length === 0) return [''];

    const chunks: string[] = [];
    for (let index = 0; index < value.length; index += this.chunkSize) {
      chunks.push(value.slice(index, index + this.chunkSize));
    }
    return chunks;
  }
}
