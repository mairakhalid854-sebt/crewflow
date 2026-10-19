import type { Database } from '@crewflow/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import {
  disableMobilePushToken,
  loadMobileNotificationPreferences,
  type MobileNotificationPreferences,
  saveMobileNotificationPreferences,
  synchronizeMobilePushToken,
} from './push-notifications';

const defaultPreferences: MobileNotificationPreferences = {
  approvalsEnabled: true,
  cancellationsEnabled: true,
  jobAssignmentsEnabled: true,
  scheduleChangesEnabled: true,
};

type Feedback =
  | { readonly kind: 'error' | 'info' | 'success'; readonly message: string }
  | undefined;

export function NotificationSettingsView({
  client,
  onBack,
  role,
}: Readonly<{
  client: SupabaseClient<Database>;
  onBack: () => void;
  role: 'office' | 'owner' | 'technician';
}>) {
  const [feedback, setFeedback] = useState<Feedback>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [preferences, setPreferences] =
    useState<MobileNotificationPreferences>(defaultPreferences);

  useEffect(() => {
    let active = true;
    void loadMobileNotificationPreferences(client)
      .then((loaded) => {
        if (active) setPreferences(loaded);
      })
      .catch(() => {
        if (active) {
          setFeedback({
            kind: 'error',
            message: 'Notification preferences could not be loaded.',
          });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client]);

  function updatePreference(
    key: keyof MobileNotificationPreferences,
    value: boolean,
  ) {
    setPreferences((current) => ({ ...current, [key]: value }));
  }

  async function enableDevice() {
    if (pending) return;
    setPending(true);
    setFeedback(undefined);
    try {
      const result = await synchronizeMobilePushToken(client, true);
      setFeedback(
        result.status === 'registered'
          ? {
              kind: 'success',
              message: 'Notifications are enabled on this device.',
            }
          : { kind: 'info', message: result.message },
      );
    } catch {
      setFeedback({
        kind: 'error',
        message: 'Notifications could not be enabled. Try again.',
      });
    } finally {
      setPending(false);
    }
  }

  async function savePreferences() {
    if (pending) return;
    setPending(true);
    setFeedback(undefined);
    try {
      await saveMobileNotificationPreferences(client, preferences);
      setFeedback({
        kind: 'success',
        message: 'Notification preferences saved.',
      });
    } catch {
      setFeedback({
        kind: 'error',
        message: 'Preferences could not be saved. Check your connection.',
      });
    } finally {
      setPending(false);
    }
  }

  async function disableDevice() {
    if (pending) return;
    setPending(true);
    setFeedback(undefined);
    try {
      await disableMobilePushToken(client);
      setFeedback({
        kind: 'success',
        message: 'Notifications are disabled on this device.',
      });
    } catch {
      setFeedback({
        kind: 'error',
        message: 'This device could not be disabled. Try again.',
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        disabled={pending}
        onPress={onBack}
        style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
      >
        <Text style={styles.backButtonText}>Back to dashboard</Text>
      </Pressable>
      <Text style={styles.title}>Notification settings</Text>
      <Text style={styles.body}>
        Choose which operational alerts CrewFlow may send to this device.
      </Text>

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color="#1769F4" />
          <Text style={styles.body}>Loading preferences...</Text>
        </View>
      ) : (
        <View style={styles.preferenceList}>
          <PreferenceSwitch
            label="Job assignments"
            onValueChange={(value) =>
              updatePreference('jobAssignmentsEnabled', value)
            }
            value={preferences.jobAssignmentsEnabled}
          />
          <PreferenceSwitch
            label="Schedule changes"
            onValueChange={(value) =>
              updatePreference('scheduleChangesEnabled', value)
            }
            value={preferences.scheduleChangesEnabled}
          />
          <PreferenceSwitch
            label="Job cancellations"
            onValueChange={(value) =>
              updatePreference('cancellationsEnabled', value)
            }
            value={preferences.cancellationsEnabled}
          />
          {role === 'technician' ? null : (
            <PreferenceSwitch
              label="Items awaiting approval"
              onValueChange={(value) =>
                updatePreference('approvalsEnabled', value)
              }
              value={preferences.approvalsEnabled}
            />
          )}
        </View>
      )}

      {feedback ? (
        <Text
          accessibilityRole={feedback.kind === 'error' ? 'alert' : undefined}
          style={[
            styles.feedback,
            feedback.kind === 'error' && styles.error,
            feedback.kind === 'success' && styles.success,
          ]}
        >
          {feedback.message}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={pending || loading}
        onPress={() => void enableDevice()}
        style={({ pressed }) => [
          styles.primaryButton,
          (pending || loading) && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.primaryButtonText}>
          {pending ? 'Please wait...' : 'Enable on this device'}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={pending || loading}
        onPress={() => void savePreferences()}
        style={({ pressed }) => [
          styles.secondaryButton,
          (pending || loading) && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.secondaryButtonText}>Save preferences</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={pending}
        onPress={() => void disableDevice()}
        style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
      >
        <Text style={styles.disableText}>Disable this device</Text>
      </Pressable>
      <Text style={styles.helpText}>
        Remote push alerts require an installed CrewFlow development or
        production build. Expo Go cannot receive them.
      </Text>
    </View>
  );
}

function PreferenceSwitch({
  label,
  onValueChange,
  value,
}: Readonly<{
  label: string;
  onValueChange: (value: boolean) => void;
  value: boolean;
}>) {
  return (
    <View style={styles.preferenceRow}>
      <Text style={styles.preferenceLabel}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        onValueChange={onValueChange}
        trackColor={{ false: '#CBD5E1', true: '#93C5FD' }}
        thumbColor={value ? '#1769F4' : '#F8FAFC'}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: { alignSelf: 'flex-start', marginBottom: 20, paddingVertical: 6 },
  backButtonText: { color: '#1769F4', fontSize: 14, fontWeight: '700' },
  body: { color: '#64748B', fontSize: 14, lineHeight: 21, marginTop: 7 },
  disableText: { color: '#B42318', fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  error: { color: '#B42318' },
  feedback: { color: '#475569', fontSize: 13, lineHeight: 19, marginTop: 16 },
  helpText: { color: '#64748B', fontSize: 12, lineHeight: 18, marginTop: 18 },
  linkButton: { alignItems: 'center', marginTop: 14, padding: 10 },
  loadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  preferenceLabel: {
    color: '#334155',
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  preferenceList: { marginTop: 18 },
  preferenceRow: {
    alignItems: 'center',
    borderBottomColor: '#E2E8F0',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 58,
  },
  pressed: { opacity: 0.8 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#1769F4',
    borderRadius: 10,
    marginTop: 22,
    padding: 14,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#CBD5E1',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 12,
    padding: 13,
  },
  secondaryButtonText: { color: '#334155', fontSize: 14, fontWeight: '700' },
  success: { color: '#067647' },
  title: { color: '#11223C', fontSize: 25, fontWeight: '800' },
});
