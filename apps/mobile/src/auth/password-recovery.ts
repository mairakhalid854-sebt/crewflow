export const MOBILE_RECOVERY_REDIRECT_URL = 'crewflow://auth/reset';

export type RecoveryCredentials =
  | {
      readonly accessToken: string;
      readonly kind: 'implicit';
      readonly refreshToken: string;
    }
  | { readonly code: string; readonly kind: 'pkce' };

export type RecoveryLinkResult =
  | { readonly status: 'ignored' }
  | { readonly status: 'invalid' }
  | {
      readonly credentials: RecoveryCredentials;
      readonly status: 'valid';
    };

function recoveryParameters(url: URL): URLSearchParams {
  const parameters = new URLSearchParams(url.search);
  const fragment = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;

  for (const [key, value] of new URLSearchParams(fragment)) {
    if (!parameters.has(key)) parameters.set(key, value);
  }

  return parameters;
}

export function parseRecoveryLink(value: string): RecoveryLinkResult {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { status: 'ignored' };
  }

  const isRecoveryRoute =
    url.protocol === 'crewflow:' &&
    ((url.hostname === 'auth' && url.pathname === '/reset') ||
      (url.hostname === '' && url.pathname === '/auth/reset'));
  if (!isRecoveryRoute) return { status: 'ignored' };

  const parameters = recoveryParameters(url);
  const code = parameters.get('code');
  if (code) {
    return { credentials: { code, kind: 'pkce' }, status: 'valid' };
  }

  const accessToken = parameters.get('access_token');
  const refreshToken = parameters.get('refresh_token');
  if (parameters.get('type') !== 'recovery' || !accessToken || !refreshToken) {
    return { status: 'invalid' };
  }

  return {
    credentials: { accessToken, kind: 'implicit', refreshToken },
    status: 'valid',
  };
}

export function validateNewPassword(
  password: string,
  confirmation: string,
): string | undefined {
  if (password.length < 10) {
    return 'Use at least 10 characters.';
  }
  if (
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password)
  ) {
    return 'Include an uppercase letter, a lowercase letter, and a number.';
  }
  if (password !== confirmation) return 'The passwords do not match.';
  return undefined;
}
