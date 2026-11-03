import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { bearerTokenIsValid, sha256Matches } from '../src/security.js';

describe('scanner security boundaries', () => {
  it('accepts only an exact bearer credential', () => {
    const token = 'scanner-test-token-that-is-long-enough';
    expect(bearerTokenIsValid(`Bearer ${token}`, token)).toBe(true);
    expect(bearerTokenIsValid(`Bearer ${token}x`, token)).toBe(false);
    expect(bearerTokenIsValid(token, token)).toBe(false);
    expect(bearerTokenIsValid(undefined, token)).toBe(false);
  });

  it('accepts only an exact SHA-256 document boundary', () => {
    const bytes = Buffer.from('safe document');
    const digest = createHash('sha256').update(bytes).digest('hex');
    expect(sha256Matches(bytes, digest)).toBe(true);
    expect(sha256Matches(bytes, digest.toUpperCase())).toBe(true);
    expect(sha256Matches(Buffer.from('changed'), digest)).toBe(false);
    expect(sha256Matches(bytes, 'not-a-digest')).toBe(false);
  });
});
