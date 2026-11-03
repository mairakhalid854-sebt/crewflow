import { describe, expect, it } from 'vitest';

import {
  requestPath,
  resolveCorrelationId,
} from '../src/runtime/request-context.middleware.js';

describe('request context helpers', () => {
  it('preserves only a valid UUID correlation ID', () => {
    const trusted = '550e8400-e29b-41d4-a716-446655440000';

    expect(resolveCorrelationId(trusted.toUpperCase())).toBe(trusted);
  });

  it('replaces untrusted correlation values', () => {
    const generated = resolveCorrelationId('customer-email@example.com');

    expect(generated).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('logs only the route path and drops query data', () => {
    expect(requestPath('/v1/jobs?customerEmail=private@example.com')).toBe(
      '/v1/jobs',
    );
  });
});
