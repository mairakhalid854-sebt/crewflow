import { MAX_JOB_PHOTO_BYTES } from './job-media-policy';
import type {
  JobPhotoUploadPendingResult,
  PendingJobPhotoUpload,
} from './job-media-upload';

const MAX_PENDING_PHOTOS = 20;
const PENDING_PHOTO_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const QUEUE_VERSION = 1;

type QueueEntry = {
  readonly createdAtMs: number;
  readonly upload: PendingJobPhotoUpload;
};

type QueueDocument = {
  readonly entries: readonly QueueEntry[];
  readonly version: typeof QUEUE_VERSION;
};

export interface PhotoQueueMetadataStore {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
  setItem(key: string, value: string): Promise<void>;
}

export interface DurablePhotoFileStore {
  copy(userId: string, sourceUri: string): Promise<string>;
  exists(uri: string): Promise<boolean>;
  remove(userId: string, uri: string): Promise<void>;
  removeUnreferenced(
    userId: string,
    referencedUris: ReadonlySet<string>,
  ): Promise<void>;
}

type PhotoQueueOptions = {
  readonly now?: () => number;
};

function queueKey(userId: string): string {
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(userId)) {
    throw new Error('Invalid photo queue user identifier.');
  }
  return `crewflow.pending-job-photos.v${QUEUE_VERSION}.${userId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validReservation(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.mediaId === 'string' &&
    value.mediaId.length > 0 &&
    typeof value.reservedAtMs === 'number' &&
    Number.isFinite(value.reservedAtMs) &&
    typeof value.storagePath === 'string' &&
    value.storagePath.length > 0
  );
}

function validUpload(value: unknown): value is PendingJobPhotoUpload {
  return (
    isRecord(value) &&
    typeof value.byteSize === 'number' &&
    Number.isInteger(value.byteSize) &&
    value.byteSize >= 1 &&
    value.byteSize <= MAX_JOB_PHOTO_BYTES &&
    typeof value.jobId === 'string' &&
    value.jobId.length > 0 &&
    typeof value.localUri === 'string' &&
    (value.localUri.startsWith('file://') ||
      value.localUri.startsWith('blob:')) &&
    (value.mediaKind === 'before' || value.mediaKind === 'after') &&
    typeof value.stored === 'boolean' &&
    (value.reservation === undefined || validReservation(value.reservation))
  );
}

function parseQueue(raw: string): readonly QueueEntry[] | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      parsed.version !== QUEUE_VERSION ||
      !Array.isArray(parsed.entries) ||
      parsed.entries.length > MAX_PENDING_PHOTOS
    ) {
      return undefined;
    }

    const entries: QueueEntry[] = [];
    for (const entry of parsed.entries) {
      if (
        !isRecord(entry) ||
        typeof entry.createdAtMs !== 'number' ||
        !Number.isFinite(entry.createdAtMs) ||
        !validUpload(entry.upload)
      ) {
        return undefined;
      }
      entries.push({ createdAtMs: entry.createdAtMs, upload: entry.upload });
    }
    return entries;
  } catch {
    return undefined;
  }
}

function restoredResult(
  upload: PendingJobPhotoUpload,
  fileExists: boolean,
): JobPhotoUploadPendingResult {
  if (!fileExists && !upload.stored) {
    return {
      canRetry: false,
      message:
        'The saved photo file is no longer available. Discard it and capture a new photo.',
      status: 'pending',
      upload,
    };
  }

  return {
    canRetry: true,
    message: upload.stored
      ? 'A stored photo is waiting for secure confirmation. Retry when connected.'
      : 'A photo from your previous session is ready to retry.',
    status: 'pending',
    upload,
  };
}

export class JobPhotoQueue {
  private readonly now: () => number;

  constructor(
    private readonly metadata: PhotoQueueMetadataStore,
    private readonly files: DurablePhotoFileStore,
    options: PhotoQueueOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  async stage(
    userId: string,
    upload: Omit<PendingJobPhotoUpload, 'localUri'> & {
      readonly localUri: string;
    },
  ): Promise<PendingJobPhotoUpload> {
    const entries = await this.read(userId);
    if (entries.length >= MAX_PENDING_PHOTOS) {
      throw new Error(
        'Pending photo limit reached. Retry or discard an existing photo first.',
      );
    }
    if (entries.some((entry) => entry.upload.jobId === upload.jobId)) {
      throw new Error('This job already has a pending photo.');
    }

    const durableUri = await this.files.copy(userId, upload.localUri);
    const durableUpload = { ...upload, localUri: durableUri };
    try {
      await this.write(userId, [
        ...entries,
        { createdAtMs: this.now(), upload: durableUpload },
      ]);
    } catch (error) {
      await this.files.remove(userId, durableUri).catch(() => undefined);
      throw error;
    }
    return durableUpload;
  }

  async savePending(
    userId: string,
    result: JobPhotoUploadPendingResult,
  ): Promise<void> {
    await this.saveUpload(userId, result.upload);
  }

  async saveUpload(
    userId: string,
    upload: PendingJobPhotoUpload,
  ): Promise<void> {
    const entries = await this.read(userId);
    const existing = entries.find(
      (entry) => entry.upload.localUri === upload.localUri,
    );
    const nextEntry = {
      createdAtMs: existing?.createdAtMs ?? this.now(),
      upload,
    };
    const next = [
      ...entries.filter((entry) => entry.upload.localUri !== upload.localUri),
      nextEntry,
    ];
    if (next.length > MAX_PENDING_PHOTOS) {
      throw new Error('Pending photo limit reached.');
    }
    await this.write(userId, next);
  }

  async load(userId: string): Promise<readonly JobPhotoUploadPendingResult[]> {
    const entries = await this.read(userId);
    const currentTime = this.now();
    const active: QueueEntry[] = [];

    for (const entry of entries) {
      if (currentTime - entry.createdAtMs > PENDING_PHOTO_MAX_AGE_MS) {
        await this.files
          .remove(userId, entry.upload.localUri)
          .catch(() => undefined);
      } else {
        active.push(entry);
      }
    }

    if (active.length !== entries.length) await this.write(userId, active);
    const referencedUris = new Set(
      active.map((entry) => entry.upload.localUri),
    );
    await this.files.removeUnreferenced(userId, referencedUris);

    return Promise.all(
      active.map(async (entry) =>
        restoredResult(
          entry.upload,
          await this.files.exists(entry.upload.localUri),
        ),
      ),
    );
  }

  async remove(userId: string, upload: PendingJobPhotoUpload): Promise<void> {
    const entries = await this.read(userId);
    await this.write(
      userId,
      entries.filter((entry) => entry.upload.localUri !== upload.localUri),
    );
    await this.files.remove(userId, upload.localUri).catch(() => undefined);
  }

  private async read(userId: string): Promise<readonly QueueEntry[]> {
    const key = queueKey(userId);
    const raw = await this.metadata.getItem(key);
    if (!raw) return [];
    const entries = parseQueue(raw);
    if (entries) return entries;

    await this.metadata.removeItem(key);
    await this.files.removeUnreferenced(userId, new Set());
    return [];
  }

  private async write(
    userId: string,
    entries: readonly QueueEntry[],
  ): Promise<void> {
    const key = queueKey(userId);
    if (entries.length === 0) {
      await this.metadata.removeItem(key);
      return;
    }
    const document: QueueDocument = { entries, version: QUEUE_VERSION };
    await this.metadata.setItem(key, JSON.stringify(document));
  }
}
