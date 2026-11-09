'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  type AuthFormState,
  forgotPasswordAction,
  loginAction,
  signupAction,
  updatePasswordAction,
} from './actions';

const initialAuthFormState: AuthFormState = { status: 'idle' };

function SubmitButton({
  label,
  pendingLabel,
}: Readonly<{ label: string; pendingLabel: string }>) {
  const { pending } = useFormStatus();
  return (
    <button className="auth-submit" disabled={pending} type="submit">
      {pending ? pendingLabel : label}
    </button>
  );
}

function FieldError({ errors }: Readonly<{ errors?: readonly string[] }>) {
  if (!errors?.length) return null;
  return (
    <ul className="field-errors">
      {errors.map((error) => (
        <li key={error}>{error}</li>
      ))}
    </ul>
  );
}

function EyeIcon({ crossed }: Readonly<{ crossed: boolean }>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="20"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {crossed ? <path d="M3 3l18 18" /> : null}
    </svg>
  );
}

function PasswordInput({
  autoComplete,
  id,
}: Readonly<{ autoComplete: string; id: string }>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <input
        autoComplete={autoComplete}
        id={id}
        name={id}
        required
        type={visible ? 'text' : 'password'}
      />
      <button
        aria-controls={id}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        className="password-toggle"
        onClick={() => setVisible((current) => !current)}
        type="button"
      >
        <EyeIcon crossed={visible} />
      </button>
    </div>
  );
}

function StatusMessage({ state }: Readonly<{ state: AuthFormState }>) {
  if (!state.message) return null;
  return (
    <p
      className={`form-message ${state.status}`}
      role={state.status === 'error' ? 'alert' : 'status'}
    >
      {state.message}
    </p>
  );
}

export function SignupForm({
  joiningTeam = false,
  nextPath,
}: Readonly<{ joiningTeam?: boolean; nextPath?: string }>) {
  const [state, action] = useActionState(signupAction, initialAuthFormState);
  return (
    <form action={action} className="auth-form">
      {nextPath ? <input name="next" type="hidden" value={nextPath} /> : null}
      <label htmlFor="fullName">Full name</label>
      <input autoComplete="name" id="fullName" name="fullName" required />
      <FieldError errors={state.fieldErrors?.fullName} />
      <label htmlFor="email">Work email</label>
      <input
        autoComplete="email"
        id="email"
        name="email"
        required
        type="email"
      />
      <FieldError errors={state.fieldErrors?.email} />
      <label htmlFor="password">Password</label>
      <PasswordInput autoComplete="new-password" id="password" />
      <p className="field-hint">
        10+ characters with upper, lower, and number.
      </p>
      <FieldError errors={state.fieldErrors?.password} />
      <StatusMessage state={state} />
      <p className="auth-consent">
        By creating an account, you agree to the{' '}
        <Link href="/terms">Terms of Service</Link> and acknowledge the{' '}
        <Link href="/privacy">Privacy Notice</Link>.
      </p>
      <SubmitButton
        label={joiningTeam ? 'Create team account' : 'Create owner account'}
        pendingLabel="Creating account…"
      />
      <p className="auth-switch">
        Already registered?{' '}
        <Link
          href={
            nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : '/login'
          }
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function LoginForm({ nextPath }: Readonly<{ nextPath?: string }>) {
  const [state, action] = useActionState(loginAction, initialAuthFormState);
  return (
    <form action={action} className="auth-form">
      {nextPath ? <input name="next" type="hidden" value={nextPath} /> : null}
      <label htmlFor="email">Work email</label>
      <input
        autoComplete="email"
        id="email"
        name="email"
        required
        type="email"
      />
      <FieldError errors={state.fieldErrors?.email} />
      <label htmlFor="password">Password</label>
      <div className="label-link">
        <span />
        <Link href="/forgot-password">Forgot password?</Link>
      </div>
      <PasswordInput autoComplete="current-password" id="password" />
      <FieldError errors={state.fieldErrors?.password} />
      <StatusMessage state={state} />
      <SubmitButton label="Sign in" pendingLabel="Signing in…" />
      <p className="auth-switch">
        New to CrewFlow360?{' '}
        <Link
          href={
            nextPath
              ? `/signup?next=${encodeURIComponent(nextPath)}`
              : '/signup'
          }
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(
    forgotPasswordAction,
    initialAuthFormState,
  );
  return (
    <form action={action} className="auth-form">
      <label htmlFor="email">Account email</label>
      <input
        autoComplete="email"
        id="email"
        name="email"
        required
        type="email"
      />
      <FieldError errors={state.fieldErrors?.email} />
      <StatusMessage state={state} />
      <SubmitButton label="Send reset link" pendingLabel="Sending…" />
      <p className="auth-switch">
        <Link href="/login">Back to sign in</Link>
      </p>
    </form>
  );
}

export function UpdatePasswordForm() {
  const [state, action] = useActionState(
    updatePasswordAction,
    initialAuthFormState,
  );
  return (
    <form action={action} className="auth-form">
      <label htmlFor="password">New password</label>
      <PasswordInput autoComplete="new-password" id="password" />
      <p className="field-hint">
        10+ characters with upper, lower, and number.
      </p>
      <FieldError errors={state.fieldErrors?.password} />
      <label htmlFor="confirmPassword">Confirm new password</label>
      <PasswordInput autoComplete="new-password" id="confirmPassword" />
      <FieldError errors={state.fieldErrors?.confirmPassword} />
      <StatusMessage state={state} />
      <SubmitButton label="Update password" pendingLabel="Updating…" />
      {state.status === 'success' ? (
        <p className="auth-switch">
          <Link href="/app">Continue to CrewFlow360</Link>
        </p>
      ) : null}
    </form>
  );
}
