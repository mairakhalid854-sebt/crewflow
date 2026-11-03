import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

import { MAX_DOCUMENT_BYTES, type ScannerConfig } from './config.js';
import { ClamAvError, type MalwareScanner } from './clamav.js';
import { bearerTokenIsValid, sha256Matches } from './security.js';

const ALLOWED_MEDIA_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function jsonResponse(
  response: ServerResponse<IncomingMessage>,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'content-type': 'application/json; charset=utf-8',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

async function readBoundedBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const value of request as AsyncIterable<Uint8Array>) {
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > MAX_DOCUMENT_BYTES) {
      throw new RequestError(413, 'document_too_large');
    }
    chunks.push(chunk);
  }
  if (total === 0) throw new RequestError(400, 'document_empty');
  return Buffer.concat(chunks, total);
}

function parseContentLength(request: IncomingMessage): number | undefined {
  const raw = request.headers['content-length'];
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) throw new RequestError(400, 'content_length_invalid');
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new RequestError(400, 'content_length_invalid');
  }
  return parsed;
}

async function handleScan(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  config: ScannerConfig,
  scanner: MalwareScanner,
): Promise<void> {
  if (!bearerTokenIsValid(request.headers.authorization, config.authToken)) {
    throw new RequestError(401, 'unauthorized');
  }

  const mediaType = request.headers['content-type']
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  if (!mediaType || !ALLOWED_MEDIA_TYPES.has(mediaType)) {
    throw new RequestError(415, 'media_type_unsupported');
  }

  const contentLength = parseContentLength(request);
  if (contentLength !== undefined && contentLength > MAX_DOCUMENT_BYTES) {
    throw new RequestError(413, 'document_too_large');
  }

  const expectedSha256 = request.headers['x-content-sha256'];
  if (typeof expectedSha256 !== 'string') {
    throw new RequestError(400, 'content_sha256_invalid');
  }
  const bytes = await readBoundedBody(request);
  if (contentLength !== undefined && bytes.length !== contentLength) {
    throw new RequestError(400, 'content_length_mismatch');
  }
  if (!sha256Matches(bytes, expectedSha256)) {
    throw new RequestError(400, 'content_sha256_mismatch');
  }

  const result = await scanner.scan(bytes).catch(() => {
    throw new ClamAvError('clamav_scan_failed');
  });
  jsonResponse(response, 200, result);
}

export function createScannerServer(
  config: ScannerConfig,
  scanner: MalwareScanner,
): Server {
  const server = createServer((request, response) => {
    void (async () => {
      try {
        if (request.method === 'GET' && request.url === '/health') {
          jsonResponse(response, 200, { status: 'ok' });
          return;
        }
        if (request.method === 'GET' && request.url === '/ready') {
          await scanner.ready().catch(() => {
            throw new ClamAvError('clamav_readiness_failed');
          });
          jsonResponse(response, 200, { status: 'ready' });
          return;
        }
        if (request.method !== 'POST' || request.url !== '/v1/scan') {
          throw new RequestError(404, 'not_found');
        }
        await handleScan(request, response, config, scanner);
      } catch (error) {
        if (response.headersSent) {
          response.destroy();
          return;
        }
        if (error instanceof RequestError) {
          jsonResponse(response, error.status, { error: error.code });
          return;
        }
        if (error instanceof ClamAvError) {
          jsonResponse(response, 503, { error: 'scanner_unavailable' });
          return;
        }
        jsonResponse(response, 500, { error: 'internal_error' });
      }
    })();
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  return server;
}
