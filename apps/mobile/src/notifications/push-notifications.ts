import type { Database } from '@crewflow/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import {
  notificationDeepLinkFromData,
  type CrewFlowDeepLink,
} from './push-notification-policy';

const DEVICE_ID_KEY = 'crewflow.mobile.push.device-id.v1';
const NOTIFICATION_CHANNEL_ID = 'crewflow-operations';

export type MobileNotificationPreferences = {
  readonly approvalsEnabled: boolean;
  readonly cancellationsEnabled: boolean;
  readonly jobAssignmentsEnabled: boolean;
  readonly scheduleChangesEnabled: boolean;
};

export type PushRegistrationResult =
  | { readonly status: 'registered' }
  | {
      readonly message: string;
      readonly status:
        | 'configuration_required'
        | 'development_build_required'
        | 'permission_denied'
        | 'unsupported'
        | 'unavailable';
    };

Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
});

function projectId(): string | undefined {
  return process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim() || undefined;
}

function isExpoGo(): boolean {
  const constants: unknown = Constants;
  return (
    typeof constants === 'object' &&
    constants !== null &&
    'appOwnership' in constants &&
    constants.appOwnership === 'expo'
  );
}

async function installationId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;

  const created = randomUUID();
  await SecureStore.setItemAsync(DEVICE_ID_KEY, created, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return created;
}

function currentPlatform(): Database['public']['Enums']['mobile_platform'] {
  if (Platform.OS === 'ios') return 'ios';
  return 'android';
}

async function registerToken(
  client: SupabaseClient<Database>,
  expoPushToken: string,
): Promise<void> {
  const { error } = await client.rpc('register_mobile_push_token', {
    target_device_id: await installationId(),
    target_expo_push_token: expoPushToken,
    target_platform: currentPlatform(),
  });
  if (error) throw error;
}

export async function synchronizeMobilePushToken(
  client: SupabaseClient<Database>,
  requestPermission = false,
): Promise<PushRegistrationResult> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return {
      message: 'Push notifications are available in the installed mobile app.',
      status: 'unsupported',
    };
  }
  if (!Device.isDevice) {
    return {
      message: 'Use a supported physical device or push-capable simulator.',
      status: 'unsupported',
    };
  }
  if (isExpoGo()) {
    return {
      message:
        'Remote push notifications require a CrewFlow development build, not Expo Go.',
      status: 'development_build_required',
    };
  }

  const easProjectId = projectId();
  if (!easProjectId) {
    return {
      message: 'The CrewFlow EAS project ID is not configured in this build.',
      status: 'configuration_required',
    };
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
      name: 'CrewFlow operations',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && requestPermission) {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (!permission.granted) {
    return {
      message: requestPermission
        ? 'Notification permission was not granted. You can enable it in device settings.'
        : 'Notification permission has not been enabled on this device.',
      status: 'permission_denied',
    };
  }

  try {
    const token = await Notifications.getExpoPushTokenAsync({
      projectId: easProjectId,
    });
    await registerToken(client, token.data);
    return { status: 'registered' };
  } catch {
    return {
      message:
        'Push registration is temporarily unavailable. Check the connection and try again.',
      status: 'unavailable',
    };
  }
}

export async function disableMobilePushToken(
  client: SupabaseClient<Database>,
): Promise<void> {
  const deviceId = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (!deviceId) return;
  const { error } = await client.rpc('disable_mobile_push_token', {
    target_device_id: deviceId,
  });
  if (error) throw error;
}

export async function loadMobileNotificationPreferences(
  client: SupabaseClient<Database>,
): Promise<MobileNotificationPreferences> {
  const { data, error } = await client.rpc(
    'get_mobile_notification_preferences',
  );
  const row = data?.[0];
  if (error || !row) {
    throw new Error('Notification preferences could not be loaded.');
  }
  return {
    approvalsEnabled: row.approvals_enabled,
    cancellationsEnabled: row.cancellations_enabled,
    jobAssignmentsEnabled: row.job_assignments_enabled,
    scheduleChangesEnabled: row.schedule_changes_enabled,
  };
}

export async function saveMobileNotificationPreferences(
  client: SupabaseClient<Database>,
  preferences: MobileNotificationPreferences,
): Promise<void> {
  const { error } = await client.rpc('update_mobile_notification_preferences', {
    enable_approvals: preferences.approvalsEnabled,
    enable_cancellations: preferences.cancellationsEnabled,
    enable_job_assignments: preferences.jobAssignmentsEnabled,
    enable_schedule_changes: preferences.scheduleChangesEnabled,
  });
  if (error) throw error;
}

export function addPushTokenRotationListener(
  client: SupabaseClient<Database>,
): Notifications.EventSubscription {
  return Notifications.addPushTokenListener(() => {
    void synchronizeMobilePushToken(client).catch(() => undefined);
  });
}

function deepLinkFromResponse(
  response: Notifications.NotificationResponse | null,
): CrewFlowDeepLink | undefined {
  return notificationDeepLinkFromData(
    response?.notification.request.content.data,
  );
}

export function addNotificationResponseListener(
  listener: (deepLink: CrewFlowDeepLink) => void,
): Notifications.EventSubscription {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const deepLink = deepLinkFromResponse(response);
    if (deepLink) listener(deepLink);
  });
}

export async function getInitialNotificationDeepLink(): Promise<
  CrewFlowDeepLink | undefined
> {
  const response = await Notifications.getLastNotificationResponseAsync();
  await Notifications.clearLastNotificationResponseAsync();
  return deepLinkFromResponse(response);
}
