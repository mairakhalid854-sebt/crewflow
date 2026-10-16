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
import {
  type AssignedJob,
  type AssignedJobsSnapshot,
  type TechnicianProgressStatus,
  advanceAssignedJob,
  formatCustomerAddress,
  formatJobSchedule,
  loadAssignedJobs,
  partitionAssignedJobs,
  technicianProgressAction,
  validateProgressNote,
} from './src/jobs/assigned-jobs';
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

type AssignedJobsState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | {
      readonly snapshot: AssignedJobsSnapshot;
      readonly status: 'loaded';
    }
  | { readonly message: string; readonly status: 'error' };

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
  const [assignedJobsRefreshKey, setAssignedJobsRefreshKey] = useState(0);
  const [assignedJobsState, setAssignedJobsState] = useState<AssignedJobsState>(
    { status: 'idle' },
  );
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
      .select('id, role, status, tenant_id, user_id')
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

  useEffect(() => {
    let active = true;
    const access =
      accessState.status === 'loaded' && accessState.access.allowed
        ? accessState.access
        : undefined;

    if (!authClient || access?.membership.role !== 'technician') {
      setAssignedJobsState({ status: 'idle' });
      return () => {
        active = false;
      };
    }

    setAssignedJobsState({ status: 'loading' });
    void loadAssignedJobs(authClient, access.membership)
      .then((snapshot) => {
        if (active) setAssignedJobsState({ snapshot, status: 'loaded' });
      })
      .catch(() => {
        if (!active) return;
        setAssignedJobsState({
          message: 'Assigned jobs could not be loaded. Check your connection.',
          status: 'error',
        });
      });

    return () => {
      active = false;
    };
  }, [accessState, assignedJobsRefreshKey, authClient]);

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

  async function progressAssignedJob(
    jobId: string,
    status: TechnicianProgressStatus,
    note: string,
  ) {
    if (!authClient) throw new Error('Mobile client is unavailable.');
    await advanceAssignedJob(authClient, jobId, status, note);
    setAssignedJobsRefreshKey((key) => key + 1);
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
              assignedJobsState={assignedJobsState}
              email={session.user.email ?? 'Signed-in user'}
              message={
                recoveryState.status === 'success'
                  ? 'Your password has been updated securely.'
                  : undefined
              }
              onAdvanceJob={progressAssignedJob}
              onSignOut={signOut}
              onRefreshJobs={() => {
                setAssignedJobsRefreshKey((key) => key + 1);
              }}
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
  assignedJobsState,
  email,
  message,
  onAdvanceJob,
  onRefreshJobs,
  onSignOut,
  pending,
}: Readonly<{
  accessState: AccessState;
  assignedJobsState: AssignedJobsState;
  email: string;
  message?: string;
  onAdvanceJob: (
    jobId: string,
    status: TechnicianProgressStatus,
    note: string,
  ) => Promise<void>;
  onRefreshJobs: () => void;
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
  } else if (accessState.access.membership.role !== 'technician') {
    accessContent = (
      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>
          {roleLabels[accessState.access.membership.role]} access verified
        </Text>
        <Text style={styles.noticeBody}>
          Your membership is active. Owner and office mobile dashboards arrive
          in a later phase; use the CrewFlow web app for full operations.
        </Text>
      </View>
    );
  } else if (assignedJobsState.status === 'loading') {
    accessContent = (
      <View style={styles.inlineStatus}>
        <ActivityIndicator color="#1769F4" />
        <Text style={styles.noticeBody}>Loading assigned jobs...</Text>
      </View>
    );
  } else if (assignedJobsState.status === 'error') {
    accessContent = (
      <View style={styles.notice}>
        <Text accessibilityRole="alert" style={styles.errorTextCompact}>
          {assignedJobsState.message}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onRefreshJobs}
          style={({ pressed }) => [
            styles.compactButton,
            pressed && styles.buttonPressed,
          ]}
        >
          <Text style={styles.compactButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  } else if (assignedJobsState.status === 'loaded') {
    accessContent = (
      <AssignedJobsView
        onAdvanceJob={onAdvanceJob}
        onRefresh={onRefreshJobs}
        snapshot={assignedJobsState.snapshot}
      />
    );
  } else {
    accessContent = null;
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

const jobStatusLabels: Record<AssignedJob['status'], string> = {
  accepted: 'Accepted',
  cancelled: 'Cancelled',
  closed: 'Closed',
  completed: 'Completed',
  in_progress: 'In progress',
  new: 'New',
  quoted: 'Quoted',
  scheduled: 'Scheduled',
};

function AssignedJobsView({
  onAdvanceJob,
  onRefresh,
  snapshot,
}: Readonly<{
  onAdvanceJob: (
    jobId: string,
    status: TechnicianProgressStatus,
    note: string,
  ) => Promise<void>;
  onRefresh: () => void;
  snapshot: AssignedJobsSnapshot;
}>) {
  const [selectedJobId, setSelectedJobId] = useState<string>();
  const selectedJob = snapshot.jobs.find((job) => job.id === selectedJobId);

  if (selectedJob) {
    return (
      <AssignedJobDetail
        job={selectedJob}
        onAdvanceJob={onAdvanceJob}
        onBack={() => setSelectedJobId(undefined)}
        timeZone={snapshot.timeZone}
      />
    );
  }

  const { history, upcoming } = partitionAssignedJobs(snapshot.jobs);

  return (
    <View style={styles.jobsSection}>
      <View style={styles.jobsHeader}>
        <View style={styles.flex}>
          <Text style={styles.jobsEyebrow}>ASSIGNED WORK</Text>
          <Text style={styles.jobsTitle}>{snapshot.tenantName}</Text>
        </View>
        <Pressable
          accessibilityLabel="Refresh assigned jobs"
          accessibilityRole="button"
          onPress={onRefresh}
          style={({ pressed }) => [
            styles.compactButton,
            pressed && styles.buttonPressed,
          ]}
        >
          <Text style={styles.compactButtonText}>Refresh</Text>
        </Pressable>
      </View>

      {upcoming.length === 0 ? (
        <View style={styles.emptyJobs}>
          <Text style={styles.noticeTitle}>No active assignments</Text>
          <Text style={styles.noticeBody}>
            New work will appear after the office assigns it to you.
          </Text>
        </View>
      ) : (
        <View style={styles.jobGroup}>
          <Text style={styles.jobGroupTitle}>Upcoming and active</Text>
          {upcoming.map((job) => (
            <AssignedJobCard
              job={job}
              key={job.id}
              onPress={() => setSelectedJobId(job.id)}
              timeZone={snapshot.timeZone}
            />
          ))}
        </View>
      )}

      {history.length > 0 ? (
        <View style={styles.jobGroup}>
          <Text style={styles.jobGroupTitle}>Recent history</Text>
          {history.map((job) => (
            <AssignedJobCard
              job={job}
              key={job.id}
              onPress={() => setSelectedJobId(job.id)}
              timeZone={snapshot.timeZone}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function AssignedJobCard({
  job,
  onPress,
  timeZone,
}: Readonly<{
  job: AssignedJob;
  onPress: () => void;
  timeZone: string;
}>) {
  const customerName = job.customers
    ? `${job.customers.first_name} ${job.customers.last_name}`.trim()
    : 'Customer';

  return (
    <Pressable
      accessibilityLabel={`${job.title}, ${jobStatusLabels[job.status]}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.jobCard, pressed && styles.buttonPressed]}
    >
      <View style={styles.jobCardHeader}>
        <Text numberOfLines={2} style={styles.jobCardTitle}>
          {job.title}
        </Text>
        <Text style={styles.statusBadge}>{jobStatusLabels[job.status]}</Text>
      </View>
      <Text style={styles.jobSchedule}>{formatJobSchedule(job, timeZone)}</Text>
      <Text style={styles.jobMeta}>
        {customerName}
        {job.services?.name ? ` - ${job.services.name}` : ''}
      </Text>
    </Pressable>
  );
}

function AssignedJobDetail({
  job,
  onAdvanceJob,
  onBack,
  timeZone,
}: Readonly<{
  job: AssignedJob;
  onAdvanceJob: (
    jobId: string,
    status: TechnicianProgressStatus,
    note: string,
  ) => Promise<void>;
  onBack: () => void;
  timeZone: string;
}>) {
  const [progressError, setProgressError] = useState<string>();
  const [progressPending, setProgressPending] = useState(false);
  const [workNote, setWorkNote] = useState('');
  const address = formatCustomerAddress(job.customers);
  const customerName = job.customers
    ? `${job.customers.first_name} ${job.customers.last_name}`.trim()
    : 'Customer details unavailable';
  const progressAction = technicianProgressAction(job.status);
  const workNotes = [...job.job_work_notes].sort(
    (left, right) =>
      new Date(right.created_at).getTime() -
      new Date(left.created_at).getTime(),
  );

  async function submitProgress() {
    if (!progressAction || progressPending) return;
    const validationMessage = validateProgressNote(workNote, progressAction);
    if (validationMessage) {
      setProgressError(validationMessage);
      return;
    }

    setProgressError(undefined);
    setProgressPending(true);
    try {
      await onAdvanceJob(job.id, progressAction.status, workNote);
    } catch {
      setProgressPending(false);
      setProgressError(
        'Job could not be updated. Refresh it and confirm it is still assigned to you.',
      );
    }
  }

  return (
    <View style={styles.jobsSection}>
      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        style={({ pressed }) => [
          styles.backButton,
          pressed && styles.buttonPressed,
        ]}
      >
        <Text style={styles.backButtonText}>Back to assigned jobs</Text>
      </Pressable>
      <Text style={styles.jobsEyebrow}>{jobStatusLabels[job.status]}</Text>
      <Text style={styles.detailTitle}>{job.title}</Text>
      <Text style={styles.detailSchedule}>
        {formatJobSchedule(job, timeZone)}
      </Text>

      <View style={styles.detailBlock}>
        <Text style={styles.detailLabel}>Customer</Text>
        <Text style={styles.detailValue}>{customerName}</Text>
        {job.customers?.phone ? (
          <Text style={styles.detailSecondary}>{job.customers.phone}</Text>
        ) : null}
      </View>

      {address ? (
        <View style={styles.detailBlock}>
          <Text style={styles.detailLabel}>Service address</Text>
          <Text style={styles.detailValue}>{address}</Text>
        </View>
      ) : null}

      {job.services?.name ? (
        <View style={styles.detailBlock}>
          <Text style={styles.detailLabel}>Service</Text>
          <Text style={styles.detailValue}>{job.services.name}</Text>
        </View>
      ) : null}

      {job.description ? (
        <View style={styles.detailBlock}>
          <Text style={styles.detailLabel}>Work details</Text>
          <Text style={styles.detailSecondary}>{job.description}</Text>
        </View>
      ) : null}

      {workNotes.length > 0 ? (
        <View style={styles.detailBlock}>
          <Text style={styles.detailLabel}>Field notes</Text>
          {workNotes.map((note) => (
            <View key={note.id} style={styles.workNote}>
              <Text style={styles.detailSecondary}>{note.body}</Text>
              <Text style={styles.workNoteTime}>
                {new Intl.DateTimeFormat('en-US', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone,
                }).format(new Date(note.created_at))}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {progressAction ? (
        <View style={styles.progressPanel}>
          <Text style={styles.noticeTitle}>Update field progress</Text>
          <Text style={styles.noticeBody}>
            {progressAction.noteRequired
              ? 'Add a completion note for the office and customer report draft.'
              : 'You may add a note before starting this job.'}
          </Text>
          <TextInput
            accessibilityLabel="Work note"
            editable={!progressPending}
            maxLength={2000}
            multiline
            onChangeText={setWorkNote}
            placeholder={
              progressAction.noteRequired
                ? 'What work was completed?'
                : 'Optional arrival or diagnostic note'
            }
            style={[styles.input, styles.workNoteInput]}
            textAlignVertical="top"
            value={workNote}
          />
          <Text style={styles.characterCount}>{workNote.length}/2000</Text>
          {progressError ? (
            <Text accessibilityRole="alert" style={styles.errorTextCompact}>
              {progressError}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={progressPending}
            onPress={() => void submitProgress()}
            style={({ pressed }) => [
              styles.primaryButton,
              progressPending && styles.buttonDisabled,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.primaryButtonText}>
              {progressPending ? 'Saving...' : progressAction.label}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.readOnlyNotice}>
          <Text style={styles.noticeTitle}>Field progress locked</Text>
          <Text style={styles.noticeBody}>
            This assignment has no technician status action available.
          </Text>
        </View>
      )}
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
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: 22,
    paddingVertical: 6,
  },
  backButtonText: {
    color: '#1769F4',
    fontSize: 14,
    fontWeight: '700',
  },
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
  compactButton: {
    alignItems: 'center',
    borderColor: '#CBD5E1',
    borderRadius: 9,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  compactButtonText: {
    color: '#1769F4',
    fontSize: 12,
    fontWeight: '800',
  },
  characterCount: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 5,
    textAlign: 'right',
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
  errorTextCompact: {
    color: '#B42318',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
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
  detailBlock: {
    borderTopColor: '#E2E8F0',
    borderTopWidth: 1,
    marginTop: 18,
    paddingTop: 16,
  },
  detailLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  detailSchedule: {
    color: '#1769F4',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 10,
  },
  detailSecondary: {
    color: '#64748B',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 5,
  },
  detailTitle: {
    color: '#11223C',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginTop: 5,
  },
  detailValue: {
    color: '#11223C',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 22,
    marginTop: 5,
  },
  emptyJobs: {
    backgroundColor: '#F6F8FC',
    borderRadius: 12,
    marginTop: 18,
    padding: 16,
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
  jobCard: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 10,
    padding: 15,
  },
  jobCardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  jobCardTitle: {
    color: '#11223C',
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 21,
  },
  jobGroup: {
    marginTop: 22,
  },
  jobGroupTitle: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '800',
  },
  jobMeta: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 7,
  },
  jobsEyebrow: {
    color: '#1769F4',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  jobsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
  },
  jobsSection: {
    marginTop: 24,
  },
  jobsTitle: {
    color: '#11223C',
    fontSize: 19,
    fontWeight: '800',
    marginTop: 3,
  },
  jobSchedule: {
    color: '#1769F4',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 10,
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
  readOnlyNotice: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 22,
    padding: 15,
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
  progressPanel: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 22,
    padding: 15,
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
  statusBadge: {
    backgroundColor: '#E8F0FF',
    borderRadius: 999,
    color: '#174EA6',
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 5,
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
  workNote: {
    borderBottomColor: '#E2E8F0',
    borderBottomWidth: 1,
    paddingBottom: 12,
  },
  workNoteInput: {
    minHeight: 104,
  },
  workNoteTime: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 5,
  },
});
