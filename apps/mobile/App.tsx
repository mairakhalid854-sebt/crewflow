import type { Database } from '@crewflow/database';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  type MembershipAccess,
  resolveMembershipAccess,
} from './src/auth/membership-access';
import { getSupabaseClient } from './src/lib/supabase';

type AccessState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly access: MembershipAccess; readonly status: 'loaded' }
  | { readonly message: string; readonly status: 'error' };

const roleLabels = {
  office: 'Office staff',
  owner: 'Owner',
  technician: 'Technician',
} as const;

export default function App() {
  const [accessState, setAccessState] = useState<AccessState>({
    status: 'idle',
  });
  const [authClient, setAuthClient] = useState<SupabaseClient<Database> | null>(
    null,
  );
  const [configurationError, setConfigurationError] = useState<string>();
  const [email, setEmail] = useState('');
  const [formMessage, setFormMessage] = useState<string>();
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [session, setSession] = useState<Session | null>();

  useEffect(() => {
    let active = true;

    try {
      const client = getSupabaseClient();
      setAuthClient(client);

      void client.auth.getSession().then(({ data }) => {
        if (active) setSession(data.session);
      });

      const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
        if (active) setSession(nextSession);
      });

      return () => {
        active = false;
        data.subscription.unsubscribe();
      };
    } catch {
      setConfigurationError(
        'Mobile authentication is not configured on this build.',
      );
      setSession(null);
      return () => {
        active = false;
      };
    }
  }, []);

  useEffect(() => {
    let active = true;

    if (!authClient || !session) {
      setAccessState({ status: 'idle' });
      return () => {
        active = false;
      };
    }

    setAccessState({ status: 'loading' });
    void authClient
      .from('memberships')
      .select('role, status, tenant_id, user_id')
      .eq('user_id', session.user.id)
      .limit(2)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setAccessState({
            message: 'Crew access could not be verified. Try again shortly.',
            status: 'error',
          });
          return;
        }

        setAccessState({
          access: resolveMembershipAccess(data ?? []),
          status: 'loaded',
        });
      });

    return () => {
      active = false;
    };
  }, [authClient, session]);

  async function signIn() {
    if (!authClient || pending) return;

    setFormMessage(undefined);
    setPending(true);
    const { error } = await authClient.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setPending(false);

    if (error) {
      setFormMessage(
        'Email or password is incorrect, or the email is not verified.',
      );
      return;
    }

    setPassword('');
  }

  async function signOut() {
    if (!authClient || pending) return;
    setPending(true);
    await authClient.auth.signOut();
    setPending(false);
  }

  if (session === undefined) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator color="#1769F4" size="large" />
          <Text style={styles.loadingText}>Restoring your secure session…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.brandMark}>
            <Text style={styles.brandLetter}>C</Text>
          </View>
          <Text style={styles.eyebrow}>CREWFLOW MOBILE</Text>

          {configurationError ? (
            <View style={styles.card}>
              <Text style={styles.title}>Configuration required</Text>
              <Text style={styles.body}>{configurationError}</Text>
              <Text style={styles.noticeBody}>
                Add the public Expo Supabase URL and publishable key, then
                rebuild the app. Never add a service-role key here.
              </Text>
            </View>
          ) : session ? (
            <AuthenticatedView
              accessState={accessState}
              email={session.user.email ?? 'Signed-in user'}
              onSignOut={signOut}
              pending={pending}
            />
          ) : (
            <View style={styles.card}>
              <Text style={styles.title}>Sign in to your crew</Text>
              <Text style={styles.body}>
                Use the same verified account as the CrewFlow web app.
              </Text>
              <Text style={styles.label}>Work email</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="email"
                editable={!pending}
                keyboardType="email-address"
                onChangeText={setEmail}
                placeholder="you@company.com"
                style={styles.input}
                value={email}
              />
              <Text style={styles.label}>Password</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="current-password"
                editable={!pending}
                onChangeText={setPassword}
                onSubmitEditing={() => void signIn()}
                placeholder="Your password"
                secureTextEntry
                style={styles.input}
                value={password}
              />
              {formMessage ? (
                <Text accessibilityRole="alert" style={styles.errorText}>
                  {formMessage}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={pending || !email.trim() || !password}
                onPress={() => void signIn()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  (pending || !email.trim() || !password) &&
                    styles.buttonDisabled,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.primaryButtonText}>
                  {pending ? 'Signing in…' : 'Sign in'}
                </Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function AuthenticatedView({
  accessState,
  email,
  onSignOut,
  pending,
}: Readonly<{
  accessState: AccessState;
  email: string;
  onSignOut: () => Promise<void>;
  pending: boolean;
}>) {
  let accessContent: React.ReactNode;

  if (accessState.status === 'loading' || accessState.status === 'idle') {
    accessContent = (
      <View style={styles.inlineStatus}>
        <ActivityIndicator color="#1769F4" />
        <Text style={styles.noticeBody}>Verifying crew access…</Text>
      </View>
    );
  } else if (accessState.status === 'error') {
    accessContent = (
      <Text accessibilityRole="alert" style={styles.errorText}>
        {accessState.message}
      </Text>
    );
  } else if (!accessState.access.allowed) {
    accessContent = (
      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>Access unavailable</Text>
        <Text style={styles.noticeBody}>
          {accessState.access.reason === 'inactive'
            ? 'This account has no active CrewFlow membership. Ask an owner to restore access or finish onboarding on the web app.'
            : 'Access is paused because this account has multiple active workspaces. Contact support before continuing.'}
        </Text>
      </View>
    );
  } else {
    accessContent = (
      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>
          {roleLabels[accessState.access.membership.role]} access verified
        </Text>
        <Text style={styles.noticeBody}>
          Your tenant membership is active. Assigned jobs will appear here in
          the scheduling phase.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>You’re signed in</Text>
      <Text style={styles.body}>{email}</Text>
      {accessContent}
      <Pressable
        accessibilityRole="button"
        disabled={pending}
        onPress={() => void onSignOut()}
        style={({ pressed }) => [
          styles.secondaryButton,
          pending && styles.buttonDisabled,
          pressed && styles.buttonPressed,
        ]}
      >
        <Text style={styles.secondaryButtonText}>
          {pending ? 'Signing out…' : 'Sign out'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    color: '#64748B',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
  },
  brandLetter: {
    color: '#FFFFFF',
    fontSize: 25,
    fontWeight: '800',
  },
  brandMark: {
    alignItems: 'center',
    backgroundColor: '#1769F4',
    borderRadius: 14,
    height: 56,
    justifyContent: 'center',
    marginBottom: 24,
    transform: [{ rotate: '-4deg' }],
    width: 56,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 24,
    padding: 22,
    width: '100%',
  },
  centered: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  container: {
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    padding: 28,
  },
  errorText: {
    color: '#B42318',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 14,
  },
  eyebrow: {
    color: '#1769F4',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.6,
  },
  flex: {
    flex: 1,
  },
  inlineStatus: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginTop: 22,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderColor: '#CBD5E1',
    borderRadius: 10,
    borderWidth: 1,
    color: '#11223C',
    fontSize: 16,
    marginTop: 7,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  label: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 18,
  },
  loadingText: {
    color: '#64748B',
    fontSize: 14,
    marginTop: 14,
  },
  notice: {
    backgroundColor: '#F6F8FC',
    borderColor: '#E2E8F0',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 22,
    padding: 16,
  },
  noticeBody: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
  },
  noticeTitle: {
    color: '#11223C',
    fontSize: 14,
    fontWeight: '700',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#1769F4',
    borderRadius: 10,
    marginTop: 22,
    padding: 14,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  safeArea: {
    backgroundColor: '#F6F8FC',
    flex: 1,
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#CBD5E1',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 22,
    padding: 13,
  },
  secondaryButtonText: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '700',
  },
  title: {
    color: '#11223C',
    fontSize: 27,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
});
