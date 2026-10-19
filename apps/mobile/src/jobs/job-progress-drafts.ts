import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { ChunkedStorage } from '../auth/chunked-storage';
import { JobProgressDraftStore } from './job-progress-draft-queue';

export type { JobProgressDraft } from './job-progress-draft-queue';
export { progressDraftHasConflict } from './job-progress-draft-queue';

const secureStorage = new ChunkedStorage({
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

const memoryValues = new Map<string, string>();
const memoryStorage = {
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

export const jobProgressDraftStore = new JobProgressDraftStore(
  Platform.OS === 'web' ? memoryStorage : secureStorage,
);
