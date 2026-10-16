import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { ChunkedStorage } from '../auth/chunked-storage';
import {
  type DurablePhotoFileStore,
  JobPhotoQueue,
  type PhotoQueueMetadataStore,
} from './job-photo-queue';

const memoryValues = new Map<string, string>();

const memoryMetadata: PhotoQueueMetadataStore = {
  getItem(key: string) {
    return Promise.resolve(memoryValues.get(key) ?? null);
  },
  removeItem(key: string) {
    memoryValues.delete(key);
    return Promise.resolve();
  },
  setItem(key: string, value: string) {
    memoryValues.set(key, value);
    return Promise.resolve();
  },
};

const secureMetadata = new ChunkedStorage({
  deleteItemAsync(key: string) {
    return SecureStore.deleteItemAsync(key);
  },
  getItemAsync(key: string) {
    return SecureStore.getItemAsync(key);
  },
  setItemAsync(key: string, value: string) {
    return SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
});

function userDirectory(userId: string): Directory {
  return new Directory(Paths.document, 'crewflow-pending-photos', userId);
}

const nativeFiles: DurablePhotoFileStore = {
  async copy(userId, sourceUri) {
    const directory = userDirectory(userId);
    directory.create({ idempotent: true, intermediates: true });
    const randomPart = Math.random().toString(36).slice(2, 12);
    const destination = new File(directory, `${Date.now()}-${randomPart}.jpg`);
    await new File(sourceUri).copy(destination);
    return destination.uri;
  },
  exists(uri) {
    return Promise.resolve(new File(uri).exists);
  },
  remove(userId, uri) {
    const directory = userDirectory(userId);
    const file = new File(uri);
    if (file.exists && file.parentDirectory.uri === directory.uri)
      file.delete();
    return Promise.resolve();
  },
  removeUnreferenced(userId, referencedUris) {
    const directory = userDirectory(userId);
    if (!directory.exists) return Promise.resolve();
    for (const entry of directory.list()) {
      if (entry instanceof File && !referencedUris.has(entry.uri)) {
        entry.delete();
      }
    }
    return Promise.resolve();
  },
};

const webFiles: DurablePhotoFileStore = {
  copy(_userId, sourceUri) {
    return Promise.resolve(sourceUri);
  },
  exists() {
    return Promise.resolve(true);
  },
  remove() {
    return Promise.resolve();
  },
  removeUnreferenced() {
    return Promise.resolve();
  },
};

export const jobPhotoQueue = new JobPhotoQueue(
  Platform.OS === 'web' ? memoryMetadata : secureMetadata,
  Platform.OS === 'web' ? webFiles : nativeFiles,
);
