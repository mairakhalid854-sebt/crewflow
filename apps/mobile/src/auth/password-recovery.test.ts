import { describe, expect, it } from 'vitest';

import { parseRecoveryLink, validateNewPassword } from './password-recovery';

describe('parseRecoveryLink', () => {
  it('accepts an implicit recovery callback with tokens in the fragment', () => {
    expect(
      parseRecoveryLink(
        'crewflow://auth/reset#access_token=access&refresh_token=refresh&type=recovery',
      ),
    ).toEqual({
      credentials: {
        accessToken: 'access',
        kind: 'implicit',
        refreshToken: 'refresh',
      },
      status: 'valid',
    });
  });

  it('accepts a PKCE recovery callback', () => {
    expect(parseRecoveryLink('crewflow://auth/reset?code=auth-code')).toEqual({
      credentials: { code: 'auth-code', kind: 'pkce' },
      status: 'valid',
    });
  });

  it('accepts the triple-slashed form of the exact recovery route', () => {
    expect(parseRecoveryLink('crewflow:///auth/reset?code=auth-code')).toEqual({
      credentials: { code: 'auth-code', kind: 'pkce' },
      status: 'valid',
    });
  });

  it('rejects a trusted recovery route without valid recovery credentials', () => {
    expect(parseRecoveryLink('crewflow://auth/reset?type=recovery')).toEqual({
      status: 'invalid',
    });
  });

  it('ignores callbacks on another scheme or route', () => {
    expect(
      parseRecoveryLink('https://attacker.example/auth/reset?code=stolen-code'),
    ).toEqual({ status: 'ignored' });
    expect(parseRecoveryLink('crewflow://jobs/123?code=auth-code')).toEqual({
      status: 'ignored',
    });
  });
});

describe('validateNewPassword', () => {
  it('enforces the hosted password policy and matching confirmation', () => {
    expect(validateNewPassword('Short1', 'Short1')).toBe(
      'Use at least 10 characters.',
    );
    expect(validateNewPassword('lowercase12', 'lowercase12')).toBe(
      'Include an uppercase letter, a lowercase letter, and a number.',
    );
    expect(validateNewPassword('SecurePass12', 'SecurePass13')).toBe(
      'The passwords do not match.',
    );
    expect(validateNewPassword('SecurePass12', 'SecurePass12')).toBeUndefined();
  });
});
