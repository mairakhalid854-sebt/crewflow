import 'react-native-url-polyfill/auto';

import type { Database } from '@crewflow/database';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';

import { ChunkedStorage } from '../auth/chunked-storage';

let client: SupabaseClient<Database> | undefined;
let managesTokenRefresh = false;

const nativeSecureStore = {
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
};

function requiredPublicValue(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized || normalized.startsWith('replace-with-')) {
    throw new Error(`Missing mobile configuration: ${name}`);
  }
  return normalized;
}

export function getSupabaseClient(): SupabaseClient<Database> {
  if (client) return client;

  const url = requiredPublicValue(
    'EXPO_PUBLIC_SUPABASE_URL',
    process.env.EXPO_PUBLIC_SUPABASE_URL,
  );
  const publishableKey = requiredPublicValue(
    'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );

  client = createClient<Database>(url, publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: true,
      storage:
        Platform.OS === 'web'
          ? undefined
          : new ChunkedStorage(nativeSecureStore),
    },
  });

  if (Platform.OS !== 'web' && !managesTokenRefresh) {
    managesTokenRefresh = true;
    if (AppState.currentState === 'active') {
      void client.auth.startAutoRefresh();
    }
    AppState.addEventListener('change', (state) => {
      if (state === 'active') void client?.auth.startAutoRefresh();
      else void client?.auth.stopAutoRefresh();
    });
  }

  return client;
}
