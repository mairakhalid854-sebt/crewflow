import { describe, expect, it } from 'vitest';

import { parseRateLimitConfiguration } from '../src/runtime/rate-limit.config.js';

describe('parseRateLimitConfiguration', () => {
  it('uses conservative defaults', () => {
    expect(parseRateLimitConfiguration({})).toEqual({
      limit: 120,
      ttl: 60_000,
    });
  });

  it('accepts bounded integer overrides', () => {
    expect(
      parseRateLimitConfiguration({
        API_RATE_LIMIT_MAX: '75',
        API_RATE_LIMIT_WINDOW_MS: '30000',
      }),
    ).toEqual({ limit: 75, ttl: 30_000 });
  });

  it('rejects disabled, fractional, or excessive values', () => {
    expect(() =>
      parseRateLimitConfiguration({ API_RATE_LIMIT_MAX: '0' }),
    ).toThrow('API_RATE_LIMIT_MAX must be an integer between 1 and 10000');
    expect(() =>
      parseRateLimitConfiguration({ API_RATE_LIMIT_MAX: '1.5' }),
    ).toThrow('API_RATE_LIMIT_MAX must be an integer between 1 and 10000');
    expect(() =>
      parseRateLimitConfiguration({ API_RATE_LIMIT_WINDOW_MS: '3600001' }),
    ).toThrow(
      'API_RATE_LIMIT_WINDOW_MS must be an integer between 1000 and 3600000',
    );
  });
});
