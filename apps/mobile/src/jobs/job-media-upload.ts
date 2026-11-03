import type { Database } from '@crewflow/database';
import type { SupabaseClient } from '@supabase/supabase-js';

import { type JobMediaKind, jobPhotoSizeError } from './job-media-policy';

const RESERVATION_RENEW_AFTER_MS = 14 * 60 * 1000;

export type JobPhotoReservation = {
  readonly mediaId: string;
  readonly reservedAtMs: number;
  readonly storagePath: string;
};

export type PendingJobPhotoUpload = {
  readonly byteSize: number;
  readonly jobId: string;
  readonly localUri: string;
  readonly mediaKind: JobMediaKind;
  readonly reservation?: JobPhotoReservation;
  readonly stored: boolean;
};

export type JobPhotoUploadPendingResult = {
  readonly canRetry: boolean;
  readonly message: string;
  readonly status: 'pending';
  readonly upload: PendingJobPhotoUpload;
};

export type JobPhotoUploadResult =
  'cancelled' | 'uploaded' | JobPhotoUploadPendingResult;

type UploadAttemptOptions = {
  readonly nowMs?: number;
  readonly onStateChange?: (upload: PendingJobPhotoUpload) => Promise<void>;
  readonly readBytes?: (uri: string) => Promise<ArrayBuffer>;
};

async function persistState(
  onStateChange: UploadAttemptOptions['onStateChange'],
  upload: PendingJobPhotoUpload,
): Promise<void> {
  await onStateChange?.(upload).catch(() => undefined);
}

async function defaultReadBytes(uri: string): Promise<ArrayBuffer> {
  const response = await fetch(uri);
  return response.arrayBuffer();
}

function pending(
  upload: PendingJobPhotoUpload,
  message: string,
  canRetry = true,
): JobPhotoUploadPendingResult {
  return { canRetry, message, status: 'pending', upload };
}

async function tryFinalize(
  client: SupabaseClient<Database>,
  reservation: JobPhotoReservation,
): Promise<boolean> {
  try {
    const { error } = await client.rpc('finalize_assigned_job_media', {
      target_media_id: reservation.mediaId,
    });
    return !error;
  } catch {
    return false;
  }
}

export async function attemptJobPhotoUpload(
  client: SupabaseClient<Database>,
  pendingUpload: PendingJobPhotoUpload,
  options: UploadAttemptOptions = {},
): Promise<Exclude<JobPhotoUploadResult, 'cancelled'>> {
  const nowMs = options.nowMs ?? Date.now();
  const readBytes = options.readBytes ?? defaultReadBytes;
  let upload = pendingUpload;

  if (upload.reservation) {
    if (await tryFinalize(client, upload.reservation)) return 'uploaded';

    if (upload.stored) {
      return pending(
        upload,
        'Photo reached secure storage, but confirmation is still pending. Retry confirmation when your connection is stable.',
      );
    }

    if (nowMs - upload.reservation.reservedAtMs >= RESERVATION_RENEW_AFTER_MS) {
      upload = { ...upload, reservation: undefined };
    }
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await readBytes(upload.localUri);
  } catch {
    return pending(
      upload,
      'The pending photo file is no longer available. Discard it and capture a new photo.',
      false,
    );
  }

  const sizeError = jobPhotoSizeError(bytes.byteLength);
  if (sizeError || bytes.byteLength !== upload.byteSize) {
    return pending(
      upload,
      sizeError ?? 'The pending photo changed and cannot be uploaded safely.',
      false,
    );
  }

  if (!upload.reservation) {
    let reservation:
      { readonly media_id: string; readonly storage_path: string } | undefined;
    try {
      const { data: reservations, error: reservationError } = await client.rpc(
        'reserve_assigned_job_media',
        {
          media_content_type: 'image/jpeg',
          media_size_bytes: upload.byteSize,
          target_job_id: upload.jobId,
          target_media_kind: upload.mediaKind,
        },
      );
      if (!reservationError) reservation = reservations?.[0];
    } catch {
      reservation = undefined;
    }

    if (!reservation) {
      return pending(
        upload,
        'Photo upload could not be authorized. Check your connection and confirm the job is still assigned to you.',
      );
    }

    upload = {
      ...upload,
      reservation: {
        mediaId: reservation.media_id,
        reservedAtMs: nowMs,
        storagePath: reservation.storage_path,
      },
    };
    await persistState(options.onStateChange, upload);
  }

  const reservation = upload.reservation;
  if (!reservation) {
    return pending(
      upload,
      'Photo upload could not be prepared. Discard it and capture a new photo.',
      false,
    );
  }

  let uploadFailed = false;
  try {
    const { error } = await client.storage
      .from('job-media')
      .upload(reservation.storagePath, bytes, {
        cacheControl: '3600',
        contentType: 'image/jpeg',
        upsert: false,
      });
    uploadFailed = Boolean(error);
  } catch {
    uploadFailed = true;
  }

  if (uploadFailed) {
    if (await tryFinalize(client, reservation)) return 'uploaded';
    return pending(
      upload,
      'Photo upload was interrupted. Retry to continue with the same captured photo.',
    );
  }

  upload = { ...upload, stored: true };
  await persistState(options.onStateChange, upload);
  if (await tryFinalize(client, reservation)) return 'uploaded';

  return pending(
    upload,
    'Photo reached secure storage, but confirmation is still pending. Retry confirmation when your connection is stable.',
  );
}
