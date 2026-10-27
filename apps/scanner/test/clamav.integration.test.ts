import {
  createServer as createTcpServer,
  type Server as TcpServer,
  type Socket,
} from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { ClamAvClient } from '../src/clamav.js';

const servers: TcpServer[] = [];

function decodeInstream(payload: Buffer): Buffer | undefined {
  const prefix = Buffer.from('zINSTREAM\0', 'utf8');
  if (!payload.subarray(0, prefix.length).equals(prefix)) return undefined;
  const chunks: Buffer[] = [];
  let offset = prefix.length;
  while (offset + 4 <= payload.length) {
    const length = payload.readUInt32BE(offset);
    offset += 4;
    if (length === 0) return Buffer.concat(chunks);
    if (offset + length > payload.length) return undefined;
    chunks.push(payload.subarray(offset, offset + length));
    offset += length;
  }
  return undefined;
}

async function fakeClamAv(
  verdict: 'clean' | 'infected',
  scanned: Buffer[],
): Promise<{ host: string; port: number }> {
  const server = createTcpServer((socket: Socket) => {
    let request = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      request = Buffer.concat([request, chunk]);
      if (request.equals(Buffer.from('zVERSION\0', 'utf8'))) {
        socket.end('ClamAV/1.4.3/12345/Mon Oct 27 00:00:00 2026\0');
        return;
      }
      const document = decodeInstream(request);
      if (!document) return;
      scanned.push(document);
      socket.end(
        verdict === 'clean'
          ? 'stream: OK\0'
          : 'stream: Eicar-Signature FOUND\0',
      );
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('test_bind_failed');
  return { host: '127.0.0.1', port: address.port };
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

describe('ClamAV INSTREAM client', () => {
  it.each(['clean', 'infected'] as const)(
    'frames bytes and returns the %s terminal verdict',
    async (verdict) => {
      const scanned: Buffer[] = [];
      const endpoint = await fakeClamAv(verdict, scanned);
      const client = new ClamAvClient({ ...endpoint, timeoutMs: 1_000 });
      const document = Buffer.alloc(70_000, 7);

      await expect(client.scan(document)).resolves.toEqual({
        verdict,
        scannerName: 'ClamAV gateway',
        scannerVersion: '1.4.3',
      });
      expect(scanned).toHaveLength(1);
      expect(scanned[0]).toEqual(document);
    },
  );
});
