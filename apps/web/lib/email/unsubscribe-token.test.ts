import { describe, expect, it } from 'vitest';

import { isUnsubscribeToken } from './unsubscribe-token';

const customerId = '44000000-0000-4000-8000-000000000002';

describe('unsubscribe tokens', () => {
  it('accepts a customer id with a hex signature', () => {
    expect(isUnsubscribeToken(`${customerId}.${'a'.repeat(64)}`)).toBe(true);
  });

  it('rejects malformed or truncated tokens', () => {
    expect(isUnsubscribeToken(customerId)).toBe(false);
    expect(isUnsubscribeToken(`${customerId}.${'a'.repeat(63)}`)).toBe(false);
    expect(isUnsubscribeToken(`${customerId}.${'A'.repeat(64)}`)).toBe(false);
    expect(isUnsubscribeToken(`../${customerId}.${'a'.repeat(64)}`)).toBe(
      false,
    );
  });
});
