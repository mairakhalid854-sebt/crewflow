import type { Database } from '@crewflow/database';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

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
import {
  type JobPhotoUploadPendingResult,
  type JobPhotoUploadResult,
  type PendingJobPhotoUpload,
  captureAndUploadJobPhoto,
  retryJobPhotoUpload,
} from './src/jobs/job-media';
import {
  type JobMediaKind,
  allowedJobPhotoKinds,
} from './src/jobs/job-media-policy';
import { recordAssignedJobSignature } from './src/jobs/job-signature';
import {
  CUSTOMER_SIGNATURE_CONSENT,
  MAX_SIGNATURE_POINTS_PER_STROKE,
  MAX_SIGNATURE_STROKES,
  signatureDraftError,
  signaturePath,
  type SignaturePoint,
  type SignatureStroke,
} from './src/jobs/job-signature-policy';
import { getSupabaseClient } from './src/lib/supabase';
import {
  formatUsdCents,
  loadMobileOperations,
  type MobileOperationsSnapshot,
  type OperationsApproval,
  type OperationsInvoice,
  type OperationsJob,
} from './src/operations/mobile-operations';

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

type MobileOperationsState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | {
      readonly snapshot: MobileOperationsSnapshot;
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
  const [operationsRefreshKey, setOperationsRefreshKey] = useState(0);
  const [operationsState, setOperationsState] = useState<MobileOperationsState>(
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

  useEffect(() => {
    let active = true;
    const access =
      accessState.status === 'loaded' && accessState.access.allowed
        ? accessState.access
        : undefined;

    if (!authClient || !access || access.membership.role === 'technician') {
      setOperationsState({ status: 'idle' });
      return () => {
        active = false;
      };
    }

    setOperationsState({ status: 'loading' });
    void loadMobileOperations(authClient, access.membership)
      .then((snapshot) => {
        if (active) setOperationsState({ snapshot, status: 'loaded' });
      })
      .catch(() => {
        if (!active) return;
        setOperationsState({
          message:
            'Operations overview could not be loaded. Check your connection.',
          status: 'error',
        });
      });

    return () => {
      active = false;
    };
  }, [accessState, authClient, operationsRefreshKey]);

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

  async function captureAssignedJobPhoto(
    jobId: string,
    mediaKind: JobMediaKind,
  ): Promise<JobPhotoUploadResult> {
    if (!authClient) throw new Error('Mobile client is unavailable.');
    const result = await captureAndUploadJobPhoto(authClient, jobId, mediaKind);
    if (result === 'uploaded') {
      setAssignedJobsRefreshKey((key) => key + 1);
    }
    return result;
  }

  async function retryAssignedJobPhoto(
    upload: PendingJobPhotoUpload,
  ): Promise<Exclude<JobPhotoUploadResult, 'cancelled'>> {
    if (!authClient) throw new Error('Mobile client is unavailable.');
    const result = await retryJobPhotoUpload(authClient, upload);
    if (result === 'uploaded') {
      setAssignedJobsRefreshKey((key) => key + 1);
    }
    return result;
  }

  async function signAssignedJob(
    jobId: string,
    signerName: string,
    strokes: readonly SignatureStroke[],
  ) {
    if (!authClient) throw new Error('Mobile client is unavailable.');
    await recordAssignedJobSignature(authClient, jobId, signerName, strokes);
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
              onCapturePhoto={captureAssignedJobPhoto}
              onRecordSignature={signAssignedJob}
              onRetryPhoto={retryAssignedJobPhoto}
              onRefreshOperations={() => {
                setOperationsRefreshKey((key) => key + 1);
              }}
              onSignOut={signOut}
              operationsState={operationsState}
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
  onCapturePhoto,
  onRecordSignature,
  onRetryPhoto,
  onRefreshJobs,
  onRefreshOperations,
  onSignOut,
  operationsState,
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
  onCapturePhoto: (
    jobId: string,
    mediaKind: JobMediaKind,
  ) => Promise<JobPhotoUploadResult>;
  onRecordSignature: (
    jobId: string,
    signerName: string,
    strokes: readonly SignatureStroke[],
  ) => Promise<void>;
  onRetryPhoto: (
    upload: PendingJobPhotoUpload,
  ) => Promise<Exclude<JobPhotoUploadResult, 'cancelled'>>;
  onRefreshJobs: () => void;
  onRefreshOperations: () => void;
  onSignOut: () => Promise<void>;
  operationsState: MobileOperationsState;
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
    if (
      operationsState.status === 'loading' ||
      operationsState.status === 'idle'
    ) {
      accessContent = (
        <View style={styles.inlineStatus}>
          <ActivityIndicator color="#1769F4" />
          <Text style={styles.noticeBody}>Loading operations overview...</Text>
        </View>
      );
    } else if (operationsState.status === 'error') {
      accessContent = (
        <View style={styles.notice}>
          <Text accessibilityRole="alert" style={styles.errorTextCompact}>
            {operationsState.message}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onRefreshOperations}
            style={({ pressed }) => [
              styles.compactButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.compactButtonText}>Try again</Text>
          </Pressable>
        </View>
      );
    } else {
      accessContent = (
        <OperationsOverviewView
          onRefresh={onRefreshOperations}
          snapshot={operationsState.snapshot}
        />
      );
    }
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
        onCapturePhoto={onCapturePhoto}
        onRecordSignature={onRecordSignature}
        onRefresh={onRefreshJobs}
        onRetryPhoto={onRetryPhoto}
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

function OperationsOverviewView({
  onRefresh,
  snapshot,
}: Readonly<{
  onRefresh: () => void;
  snapshot: MobileOperationsSnapshot;
}>) {
  const [selectedJobId, setSelectedJobId] = useState<string>();
  const selectedJob = snapshot.jobs.find((job) => job.id === selectedJobId);

  if (selectedJob) {
    return (
      <OperationsJobDetail
        job={selectedJob}
        onBack={() => setSelectedJobId(undefined)}
        timeZone={snapshot.timeZone}
      />
    );
  }

  const metrics = [
    {
      detail: 'scheduled jobs',
      label: 'Today',
      value: snapshot.metrics.todayCount.toString(),
    },
    {
      detail: 'need a technician',
      label: 'Unassigned',
      value: snapshot.metrics.unassignedCount.toString(),
    },
    {
      detail: 'scheduled or active',
      label: 'Active',
      value: snapshot.metrics.activeCount.toString(),
    },
    {
      detail: 'sent invoices',
      label: 'Unpaid',
      value: snapshot.metrics.unpaidCount.toString(),
    },
    {
      detail: 'draft items',
      label: 'Approvals',
      value: snapshot.metrics.pendingApprovalCount.toString(),
    },
    {
      detail: 'in the workflow',
      label: 'Open',
      value: snapshot.metrics.openCount.toString(),
    },
    ...(snapshot.metrics.monthlyReceivedCents === undefined
      ? []
      : [
          {
            detail: 'received this month',
            label: 'Revenue',
            value: formatUsdCents(snapshot.metrics.monthlyReceivedCents),
          },
        ]),
  ];

  return (
    <View style={styles.operationsSection}>
      <View style={styles.jobsHeader}>
        <View style={styles.flex}>
          <Text style={styles.jobsEyebrow}>OPERATIONS OVERVIEW</Text>
          <Text style={styles.jobsTitle}>{snapshot.tenantName}</Text>
          <Text style={styles.operationsRole}>
            {roleLabels[snapshot.role]} mobile view
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Refresh operations overview"
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

      <View accessibilityLabel="Operations metrics" style={styles.metricGrid}>
        {metrics.map((metric) => (
          <View key={metric.label} style={styles.metricCard}>
            <Text style={styles.metricLabel}>{metric.label}</Text>
            <Text style={styles.metricValue}>{metric.value}</Text>
            <Text style={styles.metricDetail}>{metric.detail}</Text>
          </View>
        ))}
      </View>

      <OperationsListSection
        emptyMessage="No jobs are scheduled for today."
        title="Today's jobs"
      >
        {snapshot.todayJobs.slice(0, 10).map((job) => (
          <OperationsJobCard
            job={job}
            key={job.id}
            onPress={() => setSelectedJobId(job.id)}
            timeZone={snapshot.timeZone}
          />
        ))}
      </OperationsListSection>

      <OperationsListSection
        emptyMessage="No open jobs are waiting for assignment."
        title="Needs assignment"
      >
        {snapshot.unassignedJobs.slice(0, 10).map((job) => (
          <OperationsJobCard
            job={job}
            key={job.id}
            onPress={() => setSelectedJobId(job.id)}
            timeZone={snapshot.timeZone}
          />
        ))}
      </OperationsListSection>

      <OperationsListSection
        emptyMessage="No draft quotes, invoices, or reports need review."
        title="Pending approvals"
      >
        {snapshot.pendingApprovals.slice(0, 10).map((approval) => (
          <OperationsApprovalCard
            approval={approval}
            key={`${approval.kind}-${approval.id}`}
          />
        ))}
      </OperationsListSection>

      <OperationsListSection
        emptyMessage="No sent invoices are currently unpaid."
        title="Unpaid invoices"
      >
        {snapshot.unpaidInvoices.slice(0, 10).map((invoice) => (
          <OperationsInvoiceCard
            invoice={invoice}
            key={invoice.id}
            ownerView={snapshot.role === 'owner'}
            timeZone={snapshot.timeZone}
          />
        ))}
      </OperationsListSection>

      <View style={styles.readOnlyNotice}>
        <Text style={styles.noticeTitle}>Read-only mobile oversight</Text>
        <Text style={styles.noticeBody}>
          Use the CrewFlow web app to edit jobs or approve and send customer
          documents. Guarded mobile actions will be added separately.
        </Text>
      </View>
    </View>
  );
}

function OperationsListSection({
  children,
  emptyMessage,
  title,
}: Readonly<{
  children: React.ReactNode;
  emptyMessage: string;
  title: string;
}>) {
  const hasItems = Array.isArray(children)
    ? children.length > 0
    : Boolean(children);

  return (
    <View style={styles.operationsGroup}>
      <Text style={styles.jobGroupTitle}>{title}</Text>
      {hasItems ? (
        children
      ) : (
        <Text style={styles.operationsEmpty}>{emptyMessage}</Text>
      )}
    </View>
  );
}

function OperationsJobCard({
  job,
  onPress,
  timeZone,
}: Readonly<{ job: OperationsJob; onPress: () => void; timeZone: string }>) {
  const customerName = job.customers
    ? `${job.customers.first_name} ${job.customers.last_name}`.trim()
    : 'Customer';

  return (
    <Pressable
      accessibilityLabel={`Open ${job.title}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.operationsListCard,
        pressed && styles.buttonPressed,
      ]}
    >
      <View style={styles.jobCardHeader}>
        <Text numberOfLines={2} style={styles.operationsCardTitle}>
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

function OperationsJobDetail({
  job,
  onBack,
  timeZone,
}: Readonly<{
  job: OperationsJob;
  onBack: () => void;
  timeZone: string;
}>) {
  const customerName = job.customers
    ? `${job.customers.first_name} ${job.customers.last_name}`.trim()
    : 'Customer details unavailable';
  const address = formatCustomerAddress(job.customers);

  return (
    <View style={styles.operationsSection}>
      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        style={({ pressed }) => [
          styles.backButton,
          pressed && styles.buttonPressed,
        ]}
      >
        <Text style={styles.backButtonText}>Back to operations overview</Text>
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
      <View style={styles.detailBlock}>
        <Text style={styles.detailLabel}>Priority</Text>
        <Text style={styles.detailValue}>{job.priority}</Text>
      </View>
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
      <View style={styles.readOnlyNotice}>
        <Text style={styles.noticeTitle}>Read-only job oversight</Text>
        <Text style={styles.noticeBody}>
          Scheduling, reassignment, and status controls remain in the guarded
          web workflow.
        </Text>
      </View>
    </View>
  );
}

const approvalLabels: Record<OperationsApproval['kind'], string> = {
  invoice: 'Draft invoice',
  quote: 'Draft quote',
  report: 'Draft work report',
};

function OperationsApprovalCard({
  approval,
}: Readonly<{ approval: OperationsApproval }>) {
  return (
    <View style={styles.operationsListCard}>
      <Text style={styles.operationsCardKicker}>
        {approvalLabels[approval.kind]}
      </Text>
      <Text style={styles.operationsCardTitle}>{approval.jobTitle}</Text>
      <Text style={styles.jobMeta}>Awaiting office review on the web app</Text>
    </View>
  );
}

function OperationsInvoiceCard({
  invoice,
  ownerView,
  timeZone,
}: Readonly<{
  invoice: OperationsInvoice;
  ownerView: boolean;
  timeZone: string;
}>) {
  return (
    <View style={styles.operationsListCard}>
      <View style={styles.jobCardHeader}>
        <Text style={styles.operationsCardTitle}>
          Invoice #{invoice.invoice_number}
        </Text>
        <Text style={styles.statusBadge}>
          {invoice.status.replace('_', ' ')}
        </Text>
      </View>
      <Text style={styles.jobMeta}>
        Due{' '}
        {new Intl.DateTimeFormat('en-US', {
          dateStyle: 'medium',
          timeZone,
        }).format(new Date(invoice.due_at))}
      </Text>
      {ownerView ? (
        <Text style={styles.invoiceOutstanding}>
          {formatUsdCents(invoice.total_cents - invoice.paid_cents)} outstanding
        </Text>
      ) : null}
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
  onCapturePhoto,
  onRecordSignature,
  onRefresh,
  onRetryPhoto,
  snapshot,
}: Readonly<{
  onAdvanceJob: (
    jobId: string,
    status: TechnicianProgressStatus,
    note: string,
  ) => Promise<void>;
  onCapturePhoto: (
    jobId: string,
    mediaKind: JobMediaKind,
  ) => Promise<JobPhotoUploadResult>;
  onRecordSignature: (
    jobId: string,
    signerName: string,
    strokes: readonly SignatureStroke[],
  ) => Promise<void>;
  onRefresh: () => void;
  onRetryPhoto: (
    upload: PendingJobPhotoUpload,
  ) => Promise<Exclude<JobPhotoUploadResult, 'cancelled'>>;
  snapshot: AssignedJobsSnapshot;
}>) {
  const [selectedJobId, setSelectedJobId] = useState<string>();
  const [pendingPhotoResult, setPendingPhotoResult] =
    useState<JobPhotoUploadPendingResult>();
  const selectedJob = snapshot.jobs.find((job) => job.id === selectedJobId);

  if (selectedJob) {
    return (
      <AssignedJobDetail
        job={selectedJob}
        onAdvanceJob={onAdvanceJob}
        onBack={() => setSelectedJobId(undefined)}
        onCapturePhoto={onCapturePhoto}
        onPendingPhotoChange={setPendingPhotoResult}
        onRecordSignature={onRecordSignature}
        onRetryPhoto={onRetryPhoto}
        pendingPhotoResult={
          pendingPhotoResult?.upload.jobId === selectedJob.id
            ? pendingPhotoResult
            : undefined
        }
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
  onCapturePhoto,
  onPendingPhotoChange,
  onRecordSignature,
  onRetryPhoto,
  pendingPhotoResult,
  timeZone,
}: Readonly<{
  job: AssignedJob;
  onAdvanceJob: (
    jobId: string,
    status: TechnicianProgressStatus,
    note: string,
  ) => Promise<void>;
  onBack: () => void;
  onCapturePhoto: (
    jobId: string,
    mediaKind: JobMediaKind,
  ) => Promise<JobPhotoUploadResult>;
  onPendingPhotoChange: (
    result: JobPhotoUploadPendingResult | undefined,
  ) => void;
  onRecordSignature: (
    jobId: string,
    signerName: string,
    strokes: readonly SignatureStroke[],
  ) => Promise<void>;
  onRetryPhoto: (
    upload: PendingJobPhotoUpload,
  ) => Promise<Exclude<JobPhotoUploadResult, 'cancelled'>>;
  pendingPhotoResult?: JobPhotoUploadPendingResult;
  timeZone: string;
}>) {
  const [photoError, setPhotoError] = useState<string>();
  const [photoMessage, setPhotoMessage] = useState<string>();
  const [photoPending, setPhotoPending] = useState<JobMediaKind>();
  const [progressError, setProgressError] = useState<string>();
  const [progressPending, setProgressPending] = useState(false);
  const [workNote, setWorkNote] = useState('');
  const address = formatCustomerAddress(job.customers);
  const customerName = job.customers
    ? `${job.customers.first_name} ${job.customers.last_name}`.trim()
    : 'Customer details unavailable';
  const progressAction = technicianProgressAction(job.status);
  const pendingPhotoUpload = pendingPhotoResult?.upload;
  const photoRetryAllowed = pendingPhotoResult?.canRetry ?? true;
  const allowedPhotoKinds = allowedJobPhotoKinds(job.status);
  const uploadedPhotos = job.job_media.filter(
    (media) => media.uploaded_at !== null,
  );
  const customerSignature = job.job_signatures[0];
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

  async function capturePhoto(mediaKind: JobMediaKind) {
    if (photoPending || pendingPhotoUpload) return;
    setPhotoError(undefined);
    setPhotoMessage(undefined);
    setPhotoPending(mediaKind);

    try {
      const result = await onCapturePhoto(job.id, mediaKind);
      if (result === 'cancelled') {
        setPhotoPending(undefined);
        return;
      }
      if (result !== 'uploaded') {
        onPendingPhotoChange(result);
        setPhotoPending(undefined);
        setPhotoError(result.message);
        return;
      }
      onPendingPhotoChange(undefined);
      setPhotoPending(undefined);
      setPhotoMessage(
        `${mediaKind === 'before' ? 'Before' : 'After'} photo uploaded securely.`,
      );
    } catch (error) {
      setPhotoPending(undefined);
      setPhotoError(
        error instanceof Error
          ? error.message
          : 'Photo could not be uploaded. Try again.',
      );
    }
  }

  async function retryPhoto() {
    if (!pendingPhotoUpload || !photoRetryAllowed || photoPending) return;
    setPhotoError(undefined);
    setPhotoMessage(undefined);
    setPhotoPending(pendingPhotoUpload.mediaKind);

    try {
      const result = await onRetryPhoto(pendingPhotoUpload);
      if (result !== 'uploaded') {
        onPendingPhotoChange(result);
        setPhotoPending(undefined);
        setPhotoError(result.message);
        return;
      }
      const label =
        pendingPhotoUpload.mediaKind === 'before' ? 'Before' : 'After';
      onPendingPhotoChange(undefined);
      setPhotoPending(undefined);
      setPhotoMessage(`${label} photo uploaded securely.`);
    } catch {
      setPhotoPending(undefined);
      setPhotoError(
        'The pending photo could not be retried. Check your connection and try again.',
      );
    }
  }

  function discardPendingPhoto() {
    onPendingPhotoChange(undefined);
    setPhotoError(undefined);
    setPhotoMessage('Pending photo discarded. You can capture a new one.');
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

      <View style={styles.detailBlock}>
        <Text style={styles.detailLabel}>Private job photos</Text>
        <Text style={styles.detailSecondary}>
          {
            uploadedPhotos.filter((photo) => photo.media_kind === 'before')
              .length
          }{' '}
          before ·{' '}
          {
            uploadedPhotos.filter((photo) => photo.media_kind === 'after')
              .length
          }{' '}
          after
        </Text>
        {allowedPhotoKinds.length > 0 ? (
          <View style={styles.photoActions}>
            {allowedPhotoKinds.map((mediaKind) => (
              <Pressable
                accessibilityRole="button"
                disabled={
                  photoPending !== undefined || pendingPhotoUpload !== undefined
                }
                key={mediaKind}
                onPress={() => void capturePhoto(mediaKind)}
                style={({ pressed }) => [
                  styles.compactButton,
                  (photoPending !== undefined ||
                    pendingPhotoUpload !== undefined) &&
                    styles.buttonDisabled,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.compactButtonText}>
                  {photoPending === mediaKind
                    ? 'Uploading...'
                    : `Take ${mediaKind} photo`}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.noticeBody}>
            Photo capture is available while work is scheduled or in progress.
          </Text>
        )}
        {pendingPhotoUpload ? (
          <View style={styles.photoRetryPanel}>
            <Text style={styles.noticeTitle}>
              Pending {pendingPhotoUpload.mediaKind} photo
            </Text>
            {(photoError ?? pendingPhotoResult.message) ? (
              <Text accessibilityRole="alert" style={styles.noticeBody}>
                {photoError ?? pendingPhotoResult.message}
              </Text>
            ) : null}
            <View style={styles.photoRetryActions}>
              {photoRetryAllowed ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={photoPending !== undefined}
                  onPress={() => void retryPhoto()}
                  style={({ pressed }) => [
                    styles.compactButton,
                    photoPending !== undefined && styles.buttonDisabled,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text style={styles.compactButtonText}>
                    {photoPending
                      ? 'Retrying...'
                      : pendingPhotoUpload.stored
                        ? 'Retry confirmation'
                        : 'Retry upload'}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={photoPending !== undefined}
                onPress={discardPendingPhoto}
                style={({ pressed }) => [
                  styles.discardButton,
                  photoPending !== undefined && styles.buttonDisabled,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.discardButtonText}>Discard photo</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        {photoError && !pendingPhotoUpload ? (
          <Text accessibilityRole="alert" style={styles.errorText}>
            {photoError}
          </Text>
        ) : null}
        {photoMessage ? (
          <Text accessibilityRole="alert" style={styles.successText}>
            {photoMessage}
          </Text>
        ) : null}
      </View>

      <View style={styles.detailBlock}>
        <Text style={styles.detailLabel}>Customer signature</Text>
        {customerSignature ? (
          <View style={styles.signatureRecorded}>
            <Text style={styles.noticeTitle}>Signature securely recorded</Text>
            <Text style={styles.noticeBody}>
              {customerSignature.signer_name} signed on{' '}
              {new Intl.DateTimeFormat('en-US', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone,
              }).format(new Date(customerSignature.signed_at))}
              .
            </Text>
          </View>
        ) : job.status === 'in_progress' ? (
          <CustomerSignatureCapture
            defaultSignerName={
              job.customers
                ? `${job.customers.first_name} ${job.customers.last_name}`.trim()
                : ''
            }
            onSubmit={(signerName, strokes) =>
              onRecordSignature(job.id, signerName, strokes)
            }
          />
        ) : (
          <Text style={styles.noticeBody}>
            Signature capture is available while work is in progress.
          </Text>
        )}
      </View>

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

function CustomerSignatureCapture({
  defaultSignerName,
  onSubmit,
}: Readonly<{
  defaultSignerName: string;
  onSubmit: (
    signerName: string,
    strokes: readonly SignatureStroke[],
  ) => Promise<void>;
}>) {
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [signerName, setSignerName] = useState(defaultSignerName);
  const [strokes, setStrokes] = useState<readonly SignatureStroke[]>([]);
  const padSize = useRef({ height: 1, width: 1 });
  const strokesRef = useRef<readonly SignatureStroke[]>([]);

  function updateStrokes(next: readonly SignatureStroke[]) {
    strokesRef.current = next;
    setStrokes(next);
  }

  function pointFromTouch(
    locationX: number,
    locationY: number,
  ): SignaturePoint {
    return {
      x: Math.max(0, Math.min(1, locationX / padSize.current.width)),
      y: Math.max(0, Math.min(1, locationY / padSize.current.height)),
    };
  }

  const signatureResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          if (strokesRef.current.length >= MAX_SIGNATURE_STROKES) return;
          const point = pointFromTouch(
            event.nativeEvent.locationX,
            event.nativeEvent.locationY,
          );
          updateStrokes([...strokesRef.current, [point]]);
          setError(undefined);
        },
        onPanResponderMove: (event) => {
          const currentStrokes = strokesRef.current;
          const lastStroke = currentStrokes.at(-1);
          if (
            !lastStroke ||
            lastStroke.length >= MAX_SIGNATURE_POINTS_PER_STROKE
          ) {
            return;
          }

          const point = pointFromTouch(
            event.nativeEvent.locationX,
            event.nativeEvent.locationY,
          );
          const previousPoint = lastStroke.at(-1);
          if (
            previousPoint &&
            Math.abs(previousPoint.x - point.x) < 0.002 &&
            Math.abs(previousPoint.y - point.y) < 0.002
          ) {
            return;
          }

          updateStrokes([
            ...currentStrokes.slice(0, -1),
            [...lastStroke, point],
          ]);
        },
        onPanResponderRelease: () => {
          const currentStrokes = strokesRef.current;
          if (currentStrokes.at(-1)?.length === 1) {
            updateStrokes(currentStrokes.slice(0, -1));
          }
        },
        onPanResponderTerminate: () => {
          const currentStrokes = strokesRef.current;
          if (currentStrokes.at(-1)?.length === 1) {
            updateStrokes(currentStrokes.slice(0, -1));
          }
        },
        onStartShouldSetPanResponder: () => true,
      }),
    [],
  );

  async function saveSignature() {
    if (pending) return;
    const validationMessage = signatureDraftError(
      signerName,
      strokes,
      consentAccepted,
    );
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setError(undefined);
    setPending(true);
    try {
      await onSubmit(signerName.trim(), strokes);
    } catch (saveError) {
      setPending(false);
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Signature could not be recorded. Try again.',
      );
    }
  }

  return (
    <View style={styles.signatureCapture}>
      <Text style={styles.noticeBody}>
        Hand the device to the customer. Their consent, server timestamp, job,
        and signature are saved as immutable evidence.
      </Text>
      <Text style={styles.label}>Signer name</Text>
      <TextInput
        autoCapitalize="words"
        editable={!pending}
        maxLength={120}
        onChangeText={setSignerName}
        placeholder="Customer or authorized signer"
        style={styles.input}
        value={signerName}
      />
      <Text style={styles.label}>Draw signature</Text>
      <View
        accessibilityLabel="Customer signature drawing area"
        onLayout={(event) => {
          padSize.current = {
            height: Math.max(1, event.nativeEvent.layout.height),
            width: Math.max(1, event.nativeEvent.layout.width),
          };
        }}
        style={styles.signaturePad}
        {...signatureResponder.panHandlers}
      >
        <Svg
          height="100%"
          pointerEvents="none"
          viewBox="0 0 1000 300"
          width="100%"
        >
          {strokes.map((stroke, index) => (
            <Path
              d={signaturePath(stroke)}
              fill="none"
              key={index}
              stroke="#11223C"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={5}
            />
          ))}
        </Svg>
        {strokes.length === 0 ? (
          <Text pointerEvents="none" style={styles.signaturePlaceholder}>
            Sign here
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={pending || strokes.length === 0}
        onPress={() => updateStrokes([])}
        style={({ pressed }) => [
          styles.signatureClearButton,
          (pending || strokes.length === 0) && styles.buttonDisabled,
          pressed && styles.buttonPressed,
        ]}
      >
        <Text style={styles.linkButtonText}>Clear signature</Text>
      </Pressable>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: consentAccepted, disabled: pending }}
        disabled={pending}
        onPress={() => setConsentAccepted((accepted) => !accepted)}
        style={({ pressed }) => [
          styles.consentRow,
          pressed && styles.buttonPressed,
        ]}
      >
        <View
          style={[
            styles.consentCheckbox,
            consentAccepted && styles.consentCheckboxChecked,
          ]}
        >
          {consentAccepted ? <Text style={styles.consentCheck}>✓</Text> : null}
        </View>
        <Text style={styles.consentText}>{CUSTOMER_SIGNATURE_CONSENT}</Text>
      </Pressable>
      <Text style={styles.signatureDisclaimer}>
        Electronic-signature legal sufficiency can depend on the business use
        case and local law.
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={styles.errorTextCompact}>
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={pending}
        onPress={() => void saveSignature()}
        style={({ pressed }) => [
          styles.primaryButton,
          pending && styles.buttonDisabled,
          pressed && styles.buttonPressed,
        ]}
      >
        <Text style={styles.primaryButtonText}>
          {pending ? 'Recording signature...' : 'Record customer signature'}
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
  discardButton: {
    alignItems: 'center',
    borderColor: '#FCA5A5',
    borderRadius: 9,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  discardButtonText: {
    color: '#B42318',
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
  invoiceOutstanding: {
    color: '#067647',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 8,
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
  metricCard: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 12,
    borderWidth: 1,
    flexBasis: '46%',
    flexGrow: 1,
    minWidth: 130,
    padding: 14,
  },
  metricDetail: {
    color: '#64748B',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 18,
  },
  metricLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  metricValue: {
    color: '#11223C',
    fontSize: 23,
    fontWeight: '900',
    marginTop: 5,
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
  operationsCardKicker: {
    color: '#1769F4',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    marginBottom: 5,
    textTransform: 'uppercase',
  },
  operationsCardTitle: {
    color: '#11223C',
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
  },
  operationsEmpty: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 9,
  },
  operationsGroup: {
    borderTopColor: '#E2E8F0',
    borderTopWidth: 1,
    marginTop: 22,
    paddingTop: 18,
  },
  operationsListCard: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 10,
    padding: 14,
  },
  operationsRole: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 4,
  },
  operationsSection: {
    marginTop: 24,
  },
  photoActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  photoRetryActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  photoRetryPanel: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FED7AA',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 14,
    padding: 14,
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
  consentCheck: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 16,
  },
  consentCheckbox: {
    alignItems: 'center',
    borderColor: '#94A3B8',
    borderRadius: 5,
    borderWidth: 1,
    height: 22,
    justifyContent: 'center',
    marginTop: 2,
    width: 22,
  },
  consentCheckboxChecked: {
    backgroundColor: '#1769F4',
    borderColor: '#1769F4',
  },
  consentRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  consentText: {
    color: '#334155',
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  signatureCapture: {
    marginTop: 6,
  },
  signatureClearButton: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  signatureDisclaimer: {
    color: '#94A3B8',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 10,
  },
  signaturePad: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#CBD5E1',
    borderRadius: 10,
    borderWidth: 1,
    height: 180,
    justifyContent: 'center',
    marginTop: 8,
    overflow: 'hidden',
    width: '100%',
  },
  signaturePlaceholder: {
    color: '#94A3B8',
    fontSize: 18,
    fontStyle: 'italic',
    position: 'absolute',
  },
  signatureRecorded: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 8,
    padding: 13,
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
