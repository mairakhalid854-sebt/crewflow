import type { Database } from '@crewflow/database';

export const MAX_JOB_PHOTO_BYTES = 5 * 1024 * 1024;

export type JobMediaKind = Database['public']['Enums']['job_media_kind'];
type JobStatus = Database['public']['Enums']['job_status'];

export function allowedJobPhotoKinds(
  status: JobStatus,
): readonly JobMediaKind[] {
  if (status === 'scheduled') return ['before'];
  if (status === 'in_progress') return ['before', 'after'];
  return [];
}

export function jobPhotoSizeError(byteSize: number): string | undefined {
  if (!Number.isSafeInteger(byteSize) || byteSize < 1) {
    return 'The captured photo is empty or unreadable.';
  }
  if (byteSize > MAX_JOB_PHOTO_BYTES) {
    return 'The compressed photo is larger than 5 MB. Try again.';
  }
  return undefined;
}
