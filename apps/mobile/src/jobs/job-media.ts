import type { Database } from '@crewflow/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { type JobMediaKind, jobPhotoSizeError } from './job-media-policy';

export type JobPhotoUploadResult = 'cancelled' | 'uploaded';

export class JobPhotoUploadError extends Error {}

export async function captureAndUploadJobPhoto(
  client: SupabaseClient<Database>,
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

  const { data: reservations, error: reservationError } = await client.rpc(
    'reserve_assigned_job_media',
    {
      media_content_type: 'image/jpeg',
      media_size_bytes: bytes.byteLength,
      target_job_id: jobId,
      target_media_kind: mediaKind,
    },
  );
  const reservation = reservations?.[0];
  if (reservationError || !reservation) {
    throw new JobPhotoUploadError(
      'Photo upload could not be authorized. Refresh the assignment and try again.',
    );
  }

  const { error: uploadError } = await client.storage
    .from('job-media')
    .upload(reservation.storage_path, bytes, {
      cacheControl: '3600',
      contentType: 'image/jpeg',
      upsert: false,
    });
  if (uploadError) {
    throw new JobPhotoUploadError(
      'Photo upload failed. Check your connection and try again.',
    );
  }

  const { error: finalizeError } = await client.rpc(
    'finalize_assigned_job_media',
    { target_media_id: reservation.media_id },
  );
  if (finalizeError) {
    throw new JobPhotoUploadError(
      'Photo uploaded but could not be confirmed. Refresh before trying again.',
    );
  }

  return 'uploaded';
}
