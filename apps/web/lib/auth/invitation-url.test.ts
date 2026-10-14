import { describe, expect, it } from 'vitest';

import {
  invitationSignupUrl,
  invitationTokenFromNextPath,
} from './invitation-url';

describe('team invitation signup URL', () => {
  it('opens team signup and preserves the invitation token', () => {
    const token = 'a'.repeat(64);

    expect(invitationSignupUrl('https://crewflow.example/', token)).toBe(
      `https://crewflow.example/signup?next=${encodeURIComponent(`/invite/${token}`)}`,
    );
  });

  it('extracts only a valid invitation token from a safe next path', () => {
    const token = 'b'.repeat(64);
    expect(invitationTokenFromNextPath(`/invite/${token}`)).toBe(token);
    expect(invitationTokenFromNextPath('/app')).toBeNull();
    expect(invitationTokenFromNextPath('/invite/not-a-token')).toBeNull();
  });
});
