/* global AbortSignal, fetch */

import process from 'node:process';
import { pathToFileURL, URL } from 'node:url';

const requiredHeaders = new Map([
  ['referrer-policy', 'strict-origin-when-cross-origin'],
  ['strict-transport-security', 'max-age=31536000'],
  ['x-content-type-options', 'nosniff'],
  ['x-dns-prefetch-control', 'off'],
  ['x-permitted-cross-domain-policies', 'none'],
]);

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new Error('Smoke target must use HTTPS unless it is localhost.');
  }
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url;
}

function assertSecurityHeaders(response, path) {
  for (const [name, expected] of requiredHeaders) {
    const actual = response.headers.get(name);
    if (actual !== expected) {
      throw new Error(
        `${path} returned invalid ${name}: expected ${expected}, received ${actual ?? 'missing'}`,
      );
    }
  }

  const permissions = response.headers.get('permissions-policy') ?? '';
  for (const directive of [
    'camera=(self)',
    'geolocation=()',
    'microphone=()',
  ]) {
    if (!permissions.includes(directive)) {
      throw new Error(`${path} is missing Permissions-Policy ${directive}.`);
    }
  }
}

export async function runWebSmoke({
  baseUrl,
  bypassSecret,
  fetchImpl = fetch,
}) {
  const root = normalizeBaseUrl(baseUrl);
  const headers = bypassSecret
    ? { 'x-vercel-protection-bypass': bypassSecret }
    : {};
  const request = async (path, redirect = 'follow') =>
    fetchImpl(new URL(path, root), {
      headers,
      redirect,
      signal: AbortSignal.timeout(15_000),
    });

  for (const path of ['/login', '/privacy']) {
    const response = await request(path);
    if (response.status !== 200) {
      throw new Error(`${path} returned ${response.status}, expected 200.`);
    }
    assertSecurityHeaders(response, path);
  }

  const health = await request('/api/health');
  if (health.status !== 200) {
    throw new Error(`/api/health returned ${health.status}, expected 200.`);
  }
  assertSecurityHeaders(health, '/api/health');
  const healthBody = await health.json();
  if (healthBody?.service !== 'crewflow-web' || healthBody?.status !== 'ok') {
    throw new Error('/api/health returned an unexpected payload.');
  }
  if (
    (health.headers.get('cache-control') ?? '').includes('no-store') === false
  ) {
    throw new Error('/api/health must be non-cacheable.');
  }

  const protectedPage = await request('/app', 'manual');
  if (![302, 303, 307, 308].includes(protectedPage.status)) {
    throw new Error(
      `/app returned ${protectedPage.status}, expected an unauthenticated redirect.`,
    );
  }
  const location = protectedPage.headers.get('location') ?? '';
  if (!location.includes('/login') || !location.includes('next=%2Fapp')) {
    throw new Error('/app did not redirect to the purpose-bound login URL.');
  }

  return {
    checks: 4,
    target: root.origin,
  };
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;
if (invokedPath === import.meta.url) {
  const baseUrl = process.argv[2] ?? process.env.CREWFLOW_SMOKE_BASE_URL;
  if (!baseUrl) {
    throw new Error(
      'Provide a target URL argument or CREWFLOW_SMOKE_BASE_URL.',
    );
  }

  const result = await runWebSmoke({
    baseUrl,
    bypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
  });
  process.stdout.write(
    `CrewFlow web smoke passed ${result.checks} checks against ${result.target}.\n`,
  );
}
