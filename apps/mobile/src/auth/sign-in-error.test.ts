import { describe, expect, it } from 'vitest';

import { signInErrorMessage } from './sign-in-error';

describe('signInErrorMessage', () => {
  it('explains invalid credentials without blaming account activation', () => {
    expect(
      signInErrorMessage({ code: 'invalid_credentials', status: 400 }),
    ).toBe(
      'The email and password do not match. Check both fields and try again.',
    );
  });

  it('distinguishes an unconfirmed email', () => {
    expect(
      signInErrorMessage({ code: 'email_not_confirmed', status: 400 }),
    ).toBe(
      'This email is not confirmed yet. Ask the workspace owner for help.',
    );
  });

  it('gives retry guidance for throttling', () => {
    expect(signInErrorMessage({ status: 429 })).toBe(
      'Too many sign-in attempts. Wait a moment, then try again.',
    );
  });

  it('keeps unknown failures actionable', () => {
    expect(signInErrorMessage({})).toBe(
      'Sign-in failed. Check your connection and try again.',
    );
  });
});
