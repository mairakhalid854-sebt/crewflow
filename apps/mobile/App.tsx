import type { Database } from '@crewflow/database';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
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
import {
  MOBILE_RECOVERY_REDIRECT_URL,
  parseRecoveryLink,
  validateNewPassword,
} from './src/auth/password-recovery';
import { getSupabaseClient } from './src/lib/supabase';

type AccessState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly access: MembershipAccess; readonly status: 'loaded' }
  | { readonly message: string; readonly status: 'error' };

type RecoveryState =
  | { readonly status: 'idle' }
  | { readonly status: 'exchanging' }
  | { readonly status: 'ready' }
  | { readonly message: string; readonly status: 'error' }
  | { readonly status: 'success' };

const roleLabels = {
  office: 'Office staff',
  owner: 'Owner',
  technician: 'Technician',
} as const;

export default function App() {
  const linkedUrl = Linking.useLinkingURL();
  const handledRecoveryUrl = useRef<string | undefined>(undefined);
  const [accessState, setAccessState] = useState<AccessState>({
    status: 'idle',
  });
  const [authMode, setAuthMode] = useState<'forgot' | 'sign-in'>('sign-in');
  const [authClient, setAuthClient] = useState<SupabaseClient<Database> | null>(
    null,
  );
  const [configurationError, setConfigurationError] = useState<string>();
  const [email, setEmail] = useState('');
  const [formMessage, setFormMessage] = useState<string>();
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [recoveryConfirmation, setRecoveryConfirmation] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryRequestSent, setRecoveryRequestSent] = useState(false);
  const [recoveryState, setRecoveryState] = useState<RecoveryState>({
    status: 'idle',
  });
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
    if (!authClient || !linkedUrl || handledRecoveryUrl.current === linkedUrl) {
      return () => {
        active = false;
      };
    }

    const recoveryLink = parseRecoveryLink(linkedUrl);
    if (recoveryLink.status === 'ignored') {
      return () => {
        active = false;
      };
    }

    handledRecoveryUrl.current = linkedUrl;
    if (recoveryLink.status === 'invalid') {
      setRecoveryState({
        message: 'This password reset link is invalid or expired.',
        status: 'error',
      });
      return () => {
        active = false;
      };
    }

    setRecoveryState({ status: 'exchanging' });
    const credentials = recoveryLink.credentials;
    void (
      credentials.kind === 'pkce'
        ? authClient.auth.exchangeCodeForSession(credentials.code)
        : authClient.auth.setSession({
            access_token: credentials.accessToken,
            refresh_token: credentials.refreshToken,
          })
    ).then(({ error }) => {
      if (!active) return;
      setRecoveryState(
        error
          ? {
              message: 'This password reset link is invalid or expired.',
              status: 'error',
            }
          : { status: 'ready' },
      );
    });

    return () => {
      active = false;
    };
  }, [authClient, linkedUrl]);

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

  async function sendPasswordReset() {
    if (!authClient || pending) return;

    const normalizedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setFormMessage('Enter a valid account email.');
      return;
    }

    setFormMessage(undefined);
    setPending(true);
    await authClient.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: MOBILE_RECOVERY_REDIRECT_URL,
    });
    setPending(false);
    setRecoveryRequestSent(true);
  }

  async function updatePassword() {
    if (!authClient || pending) return;

    const validationMessage = validateNewPassword(
      recoveryPassword,
      recoveryConfirmation,
    );
    if (validationMessage) {
      setFormMessage(validationMessage);
      return;
    }

    setFormMessage(undefined);
    setPending(true);
    const { error } = await authClient.auth.updateUser({
      password: recoveryPassword,
    });
    setPending(false);

    if (error) {
      setFormMessage('Password could not be updated. Request a new link.');
      return;
    }

    setRecoveryPassword('');
    setRecoveryConfirmation('');
    setRecoveryState({ status: 'success' });
  }

  async function signOut() {
    if (!authClient || pending) return;
    setPending(true);
    await authClient.auth.signOut();
    setPending(false);
    setRecoveryState({ status: 'idle' });
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
          ) : recoveryState.status !== 'idle' &&
            recoveryState.status !== 'success' ? (
            <RecoveryView
              confirmation={recoveryConfirmation}
              formMessage={formMessage}
              onBack={() => {
                setFormMessage(undefined);
                setRecoveryState({ status: 'idle' });
              }}
              onChangeConfirmation={setRecoveryConfirmation}
              onChangePassword={setRecoveryPassword}
              onSubmit={updatePassword}
              password={recoveryPassword}
              pending={pending}
              state={recoveryState}
            />
          ) : session ? (
            <AuthenticatedView
              accessState={accessState}
              email={session.user.email ?? 'Signed-in user'}
              message={
                recoveryState.status === 'success'
                  ? 'Your password has been updated securely.'
                  : undefined
              }
              onSignOut={signOut}
              pending={pending}
            />
          ) : authMode === 'forgot' ? (
            <ForgotPasswordView
              email={email}
              formMessage={formMessage}
              onBack={() => {
                setAuthMode('sign-in');
                setFormMessage(undefined);
                setRecoveryRequestSent(false);
              }}
              onChangeEmail={setEmail}
              onSubmit={sendPasswordReset}
              pending={pending}
              sent={recoveryRequestSent}
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
              <Pressable
                accessibilityRole="button"
                disabled={pending}
                onPress={() => {
                  setAuthMode('forgot');
                  setFormMessage(undefined);
                }}
                style={({ pressed }) => [
                  styles.linkButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.linkButtonText}>Forgot password?</Text>
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
  message,
  onSignOut,
  pending,
}: Readonly<{
  accessState: AccessState;
  email: string;
  message?: string;
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
      {message ? <Text style={styles.successText}>{message}</Text> : null}
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

function ForgotPasswordView({
  email,
  formMessage,
  onBack,
  onChangeEmail,
  onSubmit,
  pending,
  sent,
}: Readonly<{
  email: string;
  formMessage?: string;
  onBack: () => void;
  onChangeEmail: (value: string) => void;
  onSubmit: () => Promise<void>;
  pending: boolean;
  sent: boolean;
}>) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Reset your password</Text>
      <Text style={styles.body}>
        We’ll email a secure link that opens the installed CrewFlow app.
      </Text>
      <Text style={styles.label}>Account email</Text>
      <TextInput
        autoCapitalize="none"
        autoComplete="email"
        editable={!pending}
        keyboardType="email-address"
        onChangeText={onChangeEmail}
        onSubmitEditing={() => void onSubmit()}
        placeholder="you@company.com"
        style={styles.input}
        value={email}
      />
      {formMessage ? (
        <Text accessibilityRole="alert" style={styles.errorText}>
          {formMessage}
        </Text>
      ) : null}
      {sent ? (
        <Text accessibilityRole="alert" style={styles.successText}>
          If an account exists, a password reset link has been sent.
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={pending || !email.trim()}
        onPress={() => void onSubmit()}
        style={({ pressed }) => [
          styles.primaryButton,
          (pending || !email.trim()) && styles.buttonDisabled,
          pressed && styles.buttonPressed,
        ]}
      >
        <Text style={styles.primaryButtonText}>
          {pending ? 'Sending…' : 'Send reset link'}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={pending}
        onPress={onBack}
        style={({ pressed }) => [
          styles.linkButton,
          pressed && styles.buttonPressed,
        ]}
      >
        <Text style={styles.linkButtonText}>Back to sign in</Text>
      </Pressable>
    </View>
  );
}

function RecoveryView({
  confirmation,
  formMessage,
  onBack,
  onChangeConfirmation,
  onChangePassword,
  onSubmit,
  password,
  pending,
  state,
}: Readonly<{
  confirmation: string;
  formMessage?: string;
  onBack: () => void;
  onChangeConfirmation: (value: string) => void;
  onChangePassword: (value: string) => void;
  onSubmit: () => Promise<void>;
  password: string;
  pending: boolean;
  state: Exclude<RecoveryState, { status: 'idle' } | { status: 'success' }>;
}>) {
  if (state.status === 'exchanging') {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Checking reset link</Text>
        <View style={styles.inlineStatus}>
          <ActivityIndicator color="#1769F4" />
          <Text style={styles.noticeBody}>
            Creating a secure recovery session…
          </Text>
        </View>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Reset link unavailable</Text>
        <Text accessibilityRole="alert" style={styles.errorText}>
          {state.message}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => [
            styles.secondaryButton,
            pressed && styles.buttonPressed,
          ]}
        >
          <Text style={styles.secondaryButtonText}>Back to sign in</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Choose a new password</Text>
      <Text style={styles.body}>
        Use 10+ characters with uppercase, lowercase, and a number.
      </Text>
      <Text style={styles.label}>New password</Text>
      <TextInput
        autoCapitalize="none"
        autoComplete="new-password"
        editable={!pending}
        onChangeText={onChangePassword}
        placeholder="New password"
        secureTextEntry
        style={styles.input}
        value={password}
      />
      <Text style={styles.label}>Confirm new password</Text>
      <TextInput
        autoCapitalize="none"
        autoComplete="new-password"
        editable={!pending}
        onChangeText={onChangeConfirmation}
        onSubmitEditing={() => void onSubmit()}
        placeholder="Confirm new password"
        secureTextEntry
        style={styles.input}
        value={confirmation}
      />
      {formMessage ? (
        <Text accessibilityRole="alert" style={styles.errorText}>
          {formMessage}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={pending || !password || !confirmation}
        onPress={() => void onSubmit()}
        style={({ pressed }) => [
          styles.primaryButton,
          (pending || !password || !confirmation) && styles.buttonDisabled,
          pressed && styles.buttonPressed,
        ]}
      >
        <Text style={styles.primaryButtonText}>
          {pending ? 'Updating…' : 'Update password'}
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
  linkButton: {
    alignItems: 'center',
    marginTop: 16,
    padding: 8,
  },
  linkButtonText: {
    color: '#1769F4',
    fontSize: 14,
    fontWeight: '700',
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
  successText: {
    color: '#067647',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 14,
  },
  title: {
    color: '#11223C',
    fontSize: 27,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
});
