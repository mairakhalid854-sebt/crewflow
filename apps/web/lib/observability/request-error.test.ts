import { describe, expect, it } from 'vitest';

import { createWebRequestErrorEvent } from './request-error';

describe('web request error event', () => {
  it('retains only bounded operational fields', () => {
    const error = Object.assign(new TypeError('customer@example.com failed'), {
      digest: '7816249031',
    });

    expect(
      createWebRequestErrorEvent({
        error,
        method: 'post',
        routePath: '/quote/[token]',
        routeType: 'action',
        routerKind: 'App Router',
        correlationId: '6fb2c9fa-c923-4b37-8d6b-91b3ead07b72',
        occurredAt: new Date('2026-10-27T14:00:00.000Z'),
      }),
    ).toEqual({
      timestamp: '2026-10-27T14:00:00.000Z',
      level: 'error',
      service: 'crewflow-web',
      event: 'request_error',
      method: 'POST',
      route: '/quote/[token]',
      route_type: 'action',
      router_kind: 'App Router',
      correlation_id: '6fb2c9fa-c923-4b37-8d6b-91b3ead07b72',
      error_name: 'TypeError',
      error_digest: '7816249031',
    });
  });

  it('drops unsafe identifiers and never serializes messages or request paths', () => {
    const event = createWebRequestErrorEvent({
      error: Object.assign(new Error('secret token abc123'), {
        digest: 'unsafe digest with spaces',
      }),
      method: 'GET /customer@example.com',
      routePath: '/invoice/private-token?email=customer@example.com',
      routeType: 'route',
      routerKind: 'App Router',
      correlationId: 'not-a-uuid',
      occurredAt: new Date('2026-10-27T14:00:00.000Z'),
    });

    expect(event.method).toBe('UNKNOWN');
    expect(event.route).toBe('/unknown');
    expect(event.correlation_id).toBeNull();
    expect(event.error_digest).toBeNull();
    expect(JSON.stringify(event)).not.toContain('customer@example.com');
    expect(JSON.stringify(event)).not.toContain('secret token');
    expect(JSON.stringify(event)).not.toContain('private-token');
  });

  it('uses a stable identity for non-Error failures', () => {
    const event = createWebRequestErrorEvent({
      error: { message: 'untrusted object' },
      method: 'GET',
      routePath: '/app/jobs/[id]',
      routeType: 'render',
      routerKind: 'App Router',
    });

    expect(event.error_name).toBe('UnknownError');
    expect(event.error_digest).toBeNull();
  });
});
