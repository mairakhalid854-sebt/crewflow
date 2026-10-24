import type { Database } from '@crewflow/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import * as Device from 'expo-device';
import type * as ExpoNotifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import {
  notificationDeepLinkFromData,
  type CrewFlowDeepLink,
} from './push-notification-policy';

const DEVICE_ID_KEY = 'crewflow.mobile.push.device-id.v1';
const NOTIFICATION_CHANNEL_ID = 'crewflow-operations';

type NotificationResponse = ExpoNotifications.NotificationResponse;
type NotificationSubscription = { remove: () => void };
type NotificationsModule = typeof ExpoNotifications;

let notificationsModulePromise: Promise<NotificationsModule> | undefined;

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

function projectIdFromExtra(extra: unknown): string | undefined {
  if (typeof extra !== 'object' || extra === null) return undefined;
  const eas = (extra as Record<string, unknown>)['eas'];
  if (typeof eas !== 'object' || eas === null) return undefined;
  const value = (eas as Record<string, unknown>)['projectId'];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function projectId(): string | undefined {
  const configuredEnvironmentProjectId = process.env
    .EXPO_PUBLIC_EAS_PROJECT_ID as unknown;
  const environmentProjectId =
    typeof configuredEnvironmentProjectId === 'string'
      ? configuredEnvironmentProjectId.trim()
      : undefined;
  if (environmentProjectId) return environmentProjectId;

  const configuredProjectId = projectIdFromExtra(Constants.expoConfig?.extra);
  if (configuredProjectId) return configuredProjectId;

  const buildProjectId: unknown = Constants.easConfig?.projectId;
  return typeof buildProjectId === 'string' && buildProjectId.trim()
    ? buildProjectId.trim()
    : undefined;
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

function loadNotificationsModule(): Promise<NotificationsModule> {
  notificationsModulePromise ??= import('expo-notifications').then(
    (notifications) => {
      notifications.setNotificationHandler({
        handleNotification: () =>
          Promise.resolve({
            shouldPlaySound: false,
            shouldSetBadge: false,
            shouldShowBanner: true,
            shouldShowList: true,
          }),
      });
      return notifications;
    },
  );
  return notificationsModulePromise;
}

function deferredNotificationSubscription(
  subscribe: (notifications: NotificationsModule) => NotificationSubscription,
): NotificationSubscription {
  let active = true;
  let subscription: NotificationSubscription | undefined;

  if (!isExpoGo()) {
    void loadNotificationsModule()
      .then((notifications) => {
        if (active) subscription = subscribe(notifications);
      })
      .catch(() => undefined);
  }

  return {
    remove() {
      active = false;
      subscription?.remove();
    },
  };
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

  let Notifications: NotificationsModule;
  try {
    Notifications = await loadNotificationsModule();
  } catch {
    return {
      message:
        'Push registration is temporarily unavailable. Check the connection and try again.',
      status: 'unavailable',
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
): NotificationSubscription {
  return deferredNotificationSubscription((Notifications) =>
    Notifications.addPushTokenListener(() => {
      void synchronizeMobilePushToken(client).catch(() => undefined);
    }),
  );
}

function deepLinkFromResponse(
  response: NotificationResponse | null,
): CrewFlowDeepLink | undefined {
  return notificationDeepLinkFromData(
    response?.notification.request.content.data,
  );
}

export function addNotificationResponseListener(
  listener: (deepLink: CrewFlowDeepLink) => void,
): NotificationSubscription {
  return deferredNotificationSubscription((Notifications) =>
    Notifications.addNotificationResponseReceivedListener((response) => {
      const deepLink = deepLinkFromResponse(response);
      if (deepLink) listener(deepLink);
    }),
  );
}

export async function getInitialNotificationDeepLink(): Promise<
  CrewFlowDeepLink | undefined
> {
  if (isExpoGo()) return undefined;
  const Notifications = await loadNotificationsModule();
  const response = await Notifications.getLastNotificationResponseAsync();
  await Notifications.clearLastNotificationResponseAsync();
  return deepLinkFromResponse(response);
}
