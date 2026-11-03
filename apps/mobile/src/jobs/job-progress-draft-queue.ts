import type { TechnicianProgressStatus } from './assigned-jobs';

const DRAFT_VERSION = 1;
const MAX_DRAFTS = 50;
const MAX_DRAFT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const STORAGE_PREFIX = 'crewflow.mobile.progress-drafts.v1';

export type JobProgressDraft = {
  readonly baseJobUpdatedAt: string;
  readonly jobId: string;
  readonly note: string;
  readonly savedAt: string;
  readonly targetStatus: TechnicianProgressStatus;
  readonly userId: string;
  readonly version: typeof DRAFT_VERSION;
};

export type JobProgressDraftInput = Omit<
  JobProgressDraft,
  'savedAt' | 'version'
>;

export interface ProgressDraftStorage {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
  setItem(key: string, value: string): Promise<void>;
}

function isDraft(value: unknown): value is JobProgressDraft {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Record<string, unknown>;
  return (
    draft.version === DRAFT_VERSION &&
    typeof draft.userId === 'string' &&
    typeof draft.jobId === 'string' &&
    typeof draft.note === 'string' &&
    draft.note.length <= 2000 &&
    typeof draft.baseJobUpdatedAt === 'string' &&
    !Number.isNaN(new Date(draft.baseJobUpdatedAt).getTime()) &&
    typeof draft.savedAt === 'string' &&
    !Number.isNaN(new Date(draft.savedAt).getTime()) &&
    (draft.targetStatus === 'in_progress' || draft.targetStatus === 'completed')
  );
}

export class JobProgressDraftStore {
  private pendingOperation: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: ProgressDraftStorage,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(
    userId: string,
    jobId: string,
  ): Promise<JobProgressDraft | undefined> {
    return this.exclusive(async () => {
      const drafts = await this.read(userId);
      return drafts.find((draft) => draft.jobId === jobId);
    });
  }

  async remove(userId: string, jobId: string): Promise<void> {
    return this.exclusive(async () => {
      const drafts = await this.read(userId);
      const next = drafts.filter((draft) => draft.jobId !== jobId);
      await this.write(userId, next);
    });
  }

  async save(input: JobProgressDraftInput): Promise<JobProgressDraft> {
    if (input.note.length > 2000) {
      throw new Error('Progress draft note exceeds 2,000 characters.');
    }
    return this.exclusive(async () => {
      const savedAt = this.now().toISOString();
      const draft: JobProgressDraft = {
        ...input,
        savedAt,
        version: DRAFT_VERSION,
      };
      const drafts = await this.read(input.userId);
      const next = [
        draft,
        ...drafts.filter((item) => item.jobId !== input.jobId),
      ].slice(0, MAX_DRAFTS);
      await this.write(input.userId, next);
      return draft;
    });
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pendingOperation.then(operation, operation);
    this.pendingOperation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private key(userId: string): string {
    return `${STORAGE_PREFIX}.${userId}`;
  }

  private async read(userId: string): Promise<JobProgressDraft[]> {
    const stored = await this.storage.getItem(this.key(userId));
    if (!stored) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      await this.storage.removeItem(this.key(userId));
      return [];
    }
    if (!Array.isArray(parsed)) {
      await this.storage.removeItem(this.key(userId));
      return [];
    }

    const cutoff = this.now().getTime() - MAX_DRAFT_AGE_MS;
    const drafts = parsed.filter(
      (item): item is JobProgressDraft =>
        isDraft(item) &&
        item.userId === userId &&
        new Date(item.savedAt).getTime() >= cutoff,
    );
    if (drafts.length !== parsed.length) await this.write(userId, drafts);
    return drafts.slice(0, MAX_DRAFTS);
  }

  private async write(
    userId: string,
    drafts: readonly JobProgressDraft[],
  ): Promise<void> {
    if (drafts.length === 0) {
      await this.storage.removeItem(this.key(userId));
      return;
    }
    await this.storage.setItem(this.key(userId), JSON.stringify(drafts));
  }
}

export function progressDraftHasConflict(
  draft: JobProgressDraft,
  jobUpdatedAt: string,
  targetStatus: TechnicianProgressStatus | undefined,
): boolean {
  return (
    draft.baseJobUpdatedAt !== jobUpdatedAt ||
    draft.targetStatus !== targetStatus
  );
}
