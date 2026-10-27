import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MalwareScanner } from '../src/clamav.js';
import type { ScannerConfig } from '../src/config.js';
import { createScannerServer } from '../src/server.js';

const authToken = 'scanner-test-token-that-is-long-enough';
const config: ScannerConfig = {
  authToken,
  clamAvHost: '127.0.0.1',
  clamAvPort: 3310,
  clamAvTimeoutMs: 1_000,
  host: '127.0.0.1',
  port: 0,
};
const servers: ReturnType<typeof createScannerServer>[] = [];

async function start(scanner: MalwareScanner): Promise<string> {
  const server = createScannerServer(config, scanner);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

describe('scanner HTTP boundary', () => {
  it('rejects unauthenticated calls before invoking ClamAV', async () => {
    const scan = vi.fn<MalwareScanner['scan']>();
    const baseUrl = await start({ scan });
    const response = await fetch(`${baseUrl}/v1/scan`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'safe',
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(scan).not.toHaveBeenCalled();
  });

  it('checks media type and the claimed digest before scanning', async () => {
    const scan = vi.fn<MalwareScanner['scan']>();
    const baseUrl = await start({ scan });
    const response = await fetch(`${baseUrl}/v1/scan`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'text/plain',
        'x-content-sha256': '0'.repeat(64),
      },
      body: 'safe',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'content_sha256_mismatch',
    });
    expect(scan).not.toHaveBeenCalled();
  });

  it('returns only the bounded scanner contract for a valid document', async () => {
    const bytes = Buffer.from('safe document');
    const scan = vi.fn<MalwareScanner['scan']>().mockResolvedValue({
      verdict: 'clean',
      scannerName: 'ClamAV gateway',
      scannerVersion: '1.4.3',
    });
    const baseUrl = await start({ scan });
    const response = await fetch(`${baseUrl}/v1/scan`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'text/plain',
        'x-content-sha256': createHash('sha256').update(bytes).digest('hex'),
      },
      body: bytes,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      verdict: 'clean',
      scannerName: 'ClamAV gateway',
      scannerVersion: '1.4.3',
    });
    expect(scan).toHaveBeenCalledWith(bytes);
  });

  it('fails closed without exposing ClamAV failure details', async () => {
    const baseUrl = await start({
      scan: vi.fn().mockRejectedValue(new Error('private upstream details')),
    });
    const bytes = Buffer.from('safe document');
    const response = await fetch(`${baseUrl}/v1/scan`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'text/plain',
        'x-content-sha256': createHash('sha256').update(bytes).digest('hex'),
      },
      body: bytes,
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'scanner_unavailable' });
  });
});
