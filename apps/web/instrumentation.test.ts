import { afterEach, describe, expect, it, vi } from 'vitest';

import { onRequestError } from './instrumentation';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Next.js request error instrumentation', () => {
  it('writes one redacted JSON event', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    onRequestError(
      new Error('customer@example.com and a private token'),
      {
        method: 'GET',
        headers: {
          cookie: 'session=secret',
          'x-correlation-id': '4c81bab8-7cda-4c0e-b18d-f1fd170120e1',
        },
      },
      {
        routerKind: 'App Router',
        routePath: '/invoice/[token]',
        routeType: 'render',
      },
    );

    expect(log).toHaveBeenCalledTimes(1);
    const serialized = String(log.mock.calls[0]?.[0]);
    const event = JSON.parse(serialized) as Record<string, unknown>;

    expect(event).toMatchObject({
      service: 'crewflow-web',
      event: 'request_error',
      route: '/invoice/[token]',
      correlation_id: '4c81bab8-7cda-4c0e-b18d-f1fd170120e1',
    });
    expect(serialized).not.toContain('customer@example.com');
    expect(serialized).not.toContain('private token');
    expect(serialized).not.toContain('session=secret');
  });
});
