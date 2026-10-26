/* global Response */

import assert from 'node:assert/strict';
import test from 'node:test';

import { runWebSmoke } from './web-smoke.mjs';

const securityHeaders = {
  'permissions-policy': 'camera=(self), geolocation=(), microphone=()',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'x-dns-prefetch-control': 'off',
  'x-permitted-cross-domain-policies': 'none',
};

function response(body, init = {}) {
  return new Response(body, {
    ...init,
    headers: { ...securityHeaders, ...init.headers },
  });
}

test('validates public pages, health, headers, and protected redirect', async () => {
  const requested = [];
  const result = await runWebSmoke({
    baseUrl: 'https://staging.example.test/path?ignored=true',
    bypassSecret: 'test-bypass',
    fetchImpl: async (url, init) => {
      requested.push({ init, url: url.toString() });
      if (url.pathname === '/api/health') {
        return response(
          JSON.stringify({ service: 'crewflow-web', status: 'ok' }),
          {
            headers: { 'cache-control': 'no-store, max-age=0' },
            status: 200,
          },
        );
      }
      if (url.pathname === '/app') {
        return response('', {
          headers: { location: '/login?next=%2Fapp' },
          status: 307,
        });
      }
      return response('<html></html>', { status: 200 });
    },
  });

  assert.deepEqual(result, {
    checks: 4,
    target: 'https://staging.example.test',
  });
  assert.equal(requested.length, 4);
  assert.equal(
    requested[0].init.headers['x-vercel-protection-bypass'],
    'test-bypass',
  );
  assert.equal(requested[3].init.redirect, 'manual');
});

test('rejects insecure non-local targets', async () => {
  await assert.rejects(
    runWebSmoke({ baseUrl: 'http://example.test', fetchImpl: async () => {} }),
    /must use HTTPS/,
  );
});

test('fails closed when a security header is missing', async () => {
  await assert.rejects(
    runWebSmoke({
      baseUrl: 'https://staging.example.test',
      fetchImpl: async () => new Response('', { status: 200 }),
    }),
    /invalid referrer-policy/,
  );
});
