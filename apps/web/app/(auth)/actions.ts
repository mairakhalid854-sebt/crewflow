'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { appUrl } from '../../lib/app-url';
import {
  passwordSchema,
  updatePasswordSchema,
} from '../../lib/auth/password-validation';
import { safeNextPath } from '../../lib/auth/safe-next-path';
import { createClient } from '../../lib/supabase/server';

export interface AuthFormState {
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  readonly message?: string;
  readonly status: 'idle' | 'error' | 'success';
}

const emailSchema = z
  .email('Enter a valid email address.')
  .trim()
  .toLowerCase();
const signupSchema = z.object({
  email: emailSchema,
  fullName: z.string().trim().min(2, 'Enter your full name.').max(120),
  password: passwordSchema,
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
});

function validationFailure(error: z.ZodError): AuthFormState {
  return {
    fieldErrors: error.flatten().fieldErrors,
    message: 'Please correct the highlighted fields.',
    status: 'error',
  };
}

export async function signupAction(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signupSchema.safeParse({
    email: formData.get('email'),
    fullName: formData.get('fullName'),
    password: formData.get('password'),
  });

  if (!parsed.success) return validationFailure(parsed.error);

  const next = safeNextPath(formData.get('next'));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${appUrl()}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
    password: parsed.data.password,
  });

  if (error) {
    return {
      message:
        error.code === 'over_email_send_rate_limit'
          ? 'Email delivery is temporarily limited. Please try again later or contact the workspace owner.'
          : 'We could not create the account. Please try again shortly.',
      status: 'error',
    };
  }

  // Staging can run with email confirmation disabled while custom SMTP is not
  // configured. In that mode Supabase returns an authenticated session
  // immediately, so continue the intended invitation/onboarding flow instead
  // of telling the user to wait for an email that will not be sent.
  if (data.session) redirect(next);

  return {
    message: next.startsWith('/invite/')
      ? 'Check your email. The verification link will return you to accept the team invitation.'
      : 'Check your email to verify your account, then continue to sign in.',
    status: 'success',
  };
}

export async function loginAction(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) return validationFailure(parsed.error);

  const next = safeNextPath(formData.get('next'));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return {
      message: 'Email or password is incorrect, or the email is not verified.',
      status: 'error',
    };
  }

  redirect(next);
}

export async function forgotPasswordAction(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = emailSchema.safeParse(formData.get('email'));
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${appUrl()}/auth/confirm?next=/update-password`,
  });

  // Do not disclose whether an account exists for this address.
  return {
    message: 'If an account exists, a password reset link has been sent.',
    status: 'success',
  };
}

export async function updatePasswordAction(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = updatePasswordSchema.safeParse({
    confirmPassword: formData.get('confirmPassword'),
    password: formData.get('password'),
  });
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims) redirect('/login');

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    return {
      message: 'Password could not be updated. Request a new link.',
      status: 'error',
    };
  }

  return {
    message: 'Password updated. You can continue to CrewFlow.',
    status: 'success',
  };
}

export async function logoutAction(): Promise<never> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
