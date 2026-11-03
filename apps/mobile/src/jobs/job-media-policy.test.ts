import { describe, expect, it } from 'vitest';

import {
  MAX_JOB_PHOTO_BYTES,
  allowedJobPhotoKinds,
  jobPhotoSizeError,
} from './job-media-policy';

describe('job media policy', () => {
  it('offers before photos for scheduled work and both kinds in progress', () => {
    expect(allowedJobPhotoKinds('scheduled')).toEqual(['before']);
    expect(allowedJobPhotoKinds('in_progress')).toEqual(['before', 'after']);
    expect(allowedJobPhotoKinds('completed')).toEqual([]);
    expect(allowedJobPhotoKinds('cancelled')).toEqual([]);
  });

  it('accepts non-empty photos up to five MB', () => {
    expect(jobPhotoSizeError(1)).toBeUndefined();
    expect(jobPhotoSizeError(MAX_JOB_PHOTO_BYTES)).toBeUndefined();
    expect(jobPhotoSizeError(0)).toBe(
      'The captured photo is empty or unreadable.',
    );
    expect(jobPhotoSizeError(MAX_JOB_PHOTO_BYTES + 1)).toBe(
      'The compressed photo is larger than 5 MB. Try again.',
    );
  });
});
