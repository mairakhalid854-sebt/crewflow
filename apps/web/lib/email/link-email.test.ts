import { describe, expect, it } from 'vitest';

import { linkEmailMessage } from './link-email';

describe('link email messages', () => {
  it('confirms a queued email', () => {
    expect(linkEmailMessage(null)).toBe(
      'The link is also queued for email to the recipient.',
    );
  });

  it('explains an ineligible recipient without exposing database text', () => {
    const message = linkEmailMessage({
      code: '22023',
      message: 'recipient cannot be emailed',
    });
    expect(message).toContain('opted out');
    expect(message).not.toContain('recipient cannot be emailed');
  });

  it('falls back to the copyable link for other failures', () => {
    expect(
      linkEmailMessage({
        code: '42501',
        message: 'email target is unavailable',
      }),
    ).toBe('Email could not be queued. Copy the link instead.');
  });
});
