interface SignInErrorLike {
  readonly code?: string;
  readonly status?: number;
}

export function signInErrorMessage(error: SignInErrorLike): string {
  if (error.code === 'invalid_credentials') {
    return 'The email and password do not match. Check both fields and try again.';
  }

  if (error.code === 'email_not_confirmed') {
    return 'This email is not confirmed yet. Ask the workspace owner for help.';
  }

  if (
    error.code === 'over_request_rate_limit' ||
    error.code === 'over_email_send_rate_limit' ||
    error.status === 429
  ) {
    return 'Too many sign-in attempts. Wait a moment, then try again.';
  }

  if (error.status !== undefined && error.status >= 500) {
    return 'CrewFlow sign-in is temporarily unavailable. Try again shortly.';
  }

  return 'Sign-in failed. Check your connection and try again.';
}
