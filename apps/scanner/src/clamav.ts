import { createConnection } from 'node:net';

const MAX_CLAMAV_RESPONSE_BYTES = 4_096;
const STREAM_CHUNK_BYTES = 64 * 1024;

export type MalwareVerdict = 'clean' | 'infected';

export interface MalwareScanResult {
  readonly verdict: MalwareVerdict;
  readonly scannerName: 'ClamAV gateway';
  readonly scannerVersion: string;
}

export interface MalwareScanner {
  ready(): Promise<void>;
  scan(bytes: Buffer): Promise<MalwareScanResult>;
}

export class ClamAvError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ClamAvError';
  }
}

export function parseClamAvScanResponse(response: string): MalwareVerdict {
  const normalized = response.replace(/\0+$/, '').trim();
  if (normalized === 'stream: OK') return 'clean';
  if (/^stream: .{1,512} FOUND$/.test(normalized)) return 'infected';
  throw new ClamAvError('clamav_invalid_scan_response');
}

export function parseClamAvVersion(response: string): string {
  const normalized = response.replace(/\0+$/, '').trim();
  const match = /^ClamAV\/([A-Za-z0-9.+:~_-]{1,64})(?:\/|$)/.exec(normalized);
  if (!match?.[1]) throw new ClamAvError('clamav_invalid_version_response');
  return match[1];
}

interface ClamAvConnectionOptions {
  readonly host: string;
  readonly port: number;
  readonly timeoutMs: number;
}

export class ClamAvClient implements MalwareScanner {
  constructor(private readonly options: ClamAvConnectionOptions) {}

  async ready(): Promise<void> {
    parseClamAvVersion(
      await this.sendCommand(Buffer.from('zVERSION\0', 'utf8')),
    );
  }

  async scan(bytes: Buffer): Promise<MalwareScanResult> {
    const [versionResponse, scanResponse] = await Promise.all([
      this.sendCommand(Buffer.from('zVERSION\0', 'utf8')),
      this.sendStream(bytes),
    ]);
    return {
      verdict: parseClamAvScanResponse(scanResponse),
      scannerName: 'ClamAV gateway',
      scannerVersion: parseClamAvVersion(versionResponse),
    };
  }

  private sendStream(bytes: Buffer): Promise<string> {
    const frames: Buffer[] = [Buffer.from('zINSTREAM\0', 'utf8')];
    for (let offset = 0; offset < bytes.length; offset += STREAM_CHUNK_BYTES) {
      const chunk = bytes.subarray(offset, offset + STREAM_CHUNK_BYTES);
      const length = Buffer.allocUnsafe(4);
      length.writeUInt32BE(chunk.length);
      frames.push(length, chunk);
    }
    frames.push(Buffer.alloc(4));
    return this.sendCommand(Buffer.concat(frames));
  }

  private sendCommand(payload: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({
        host: this.options.host,
        port: this.options.port,
      });
      const response: Buffer[] = [];
      let responseBytes = 0;
      let settled = false;

      const fail = (code: string) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new ClamAvError(code));
      };

      socket.setTimeout(this.options.timeoutMs);
      socket.once('connect', () => socket.end(payload));
      socket.on('data', (chunk: Buffer) => {
        responseBytes += chunk.length;
        if (responseBytes > MAX_CLAMAV_RESPONSE_BYTES) {
          fail('clamav_response_too_large');
          return;
        }
        response.push(chunk);
      });
      socket.once('timeout', () => fail('clamav_timeout'));
      socket.once('error', () => fail('clamav_unavailable'));
      socket.once('end', () => {
        if (settled) return;
        settled = true;
        resolve(Buffer.concat(response).toString('utf8'));
      });
    });
  }
}
