import type { Database } from '@crewflow/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { jobPhotoQueue } from './job-photo-queue-store';
import { type JobMediaKind, jobPhotoSizeError } from './job-media-policy';
import {
  attemptJobPhotoUpload,
  type JobPhotoUploadResult,
  type PendingJobPhotoUpload,
} from './job-media-upload';

export type {
  JobPhotoUploadPendingResult,
  JobPhotoUploadResult,
  PendingJobPhotoUpload,
} from './job-media-upload';

export class JobPhotoUploadError extends Error {}

export async function captureAndUploadJobPhoto(
  client: SupabaseClient<Database>,
  userId: string,
  jobId: string,
  mediaKind: JobMediaKind,
): Promise<JobPhotoUploadResult> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new JobPhotoUploadError(
      'Camera permission is required to capture job photos.',
    );
  }

  const capture = await ImagePicker.launchCameraAsync({
    allowsEditing: false,
    cameraType: ImagePicker.CameraType.back,
    mediaTypes: ['images'],
    quality: 1,
  });
  if (capture.canceled) return 'cancelled';

  const asset = capture.assets[0];
  if (!asset) {
    throw new JobPhotoUploadError('The captured photo could not be read.');
  }

  const actions: ImageManipulator.Action[] =
    asset.width > 1600 ? [{ resize: { width: 1600 } }] : [];
  const compressed = await ImageManipulator.manipulateAsync(
    asset.uri,
    actions,
    {
      compress: 0.75,
      format: ImageManipulator.SaveFormat.JPEG,
    },
  );

  const response = await fetch(compressed.uri);
  const bytes = await response.arrayBuffer();
  const sizeError = jobPhotoSizeError(bytes.byteLength);
  if (sizeError) throw new JobPhotoUploadError(sizeError);

  let upload: PendingJobPhotoUpload;
  try {
    upload = await jobPhotoQueue.stage(userId, {
      byteSize: bytes.byteLength,
      jobId,
      localUri: compressed.uri,
      mediaKind,
      stored: false,
    });
  } catch (error) {
    throw new JobPhotoUploadError(
      error instanceof Error
        ? error.message
        : 'The captured photo could not be saved safely on this device.',
    );
  }

  const result = await attemptJobPhotoUpload(client, upload, {
    onStateChange: (nextUpload) => jobPhotoQueue.saveUpload(userId, nextUpload),
  });
  if (result === 'uploaded') {
    await jobPhotoQueue.remove(userId, upload);
  } else {
    await jobPhotoQueue.savePending(userId, result);
  }
  return result;
}

export async function retryJobPhotoUpload(
  client: SupabaseClient<Database>,
  userId: string,
  pendingUpload: PendingJobPhotoUpload,
): Promise<Exclude<JobPhotoUploadResult, 'cancelled'>> {
  const result = await attemptJobPhotoUpload(client, pendingUpload, {
    onStateChange: (nextUpload) => jobPhotoQueue.saveUpload(userId, nextUpload),
  });
  if (result === 'uploaded') {
    await jobPhotoQueue.remove(userId, pendingUpload);
  } else {
    await jobPhotoQueue.savePending(userId, result);
  }
  return result;
}

export function restorePendingJobPhotos(userId: string) {
  return jobPhotoQueue.load(userId);
}

export function discardPendingJobPhoto(
  userId: string,
  pendingUpload: PendingJobPhotoUpload,
) {
  return jobPhotoQueue.remove(userId, pendingUpload);
}
