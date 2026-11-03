import { describe, expect, it } from 'vitest';

import { loadScannerConfig } from '../src/config.js';

const validToken = 'a'.repeat(32);

describe('scanner configuration', () => {
  it('loads bounded defaults', () => {
    expect(loadScannerConfig({ SCANNER_AUTH_TOKEN: validToken })).toEqual({
      authToken: validToken,
      clamAvHost: '127.0.0.1',
      clamAvPort: 3310,
      clamAvTimeoutMs: 15_000,
      host: '0.0.0.0',
      port: 8080,
    });
  });

  it('rejects weak credentials and invalid network values', () => {
    expect(() => loadScannerConfig({ SCANNER_AUTH_TOKEN: 'short' })).toThrow(
      'SCANNER_AUTH_TOKEN_invalid',
    );
    expect(() =>
      loadScannerConfig({
        SCANNER_AUTH_TOKEN: validToken,
        CLAMAV_PORT: 'not-a-port',
      }),
    ).toThrow('CLAMAV_PORT_invalid');
    expect(() =>
      loadScannerConfig({
        SCANNER_AUTH_TOKEN: validToken,
        CLAMAV_HOST: 'bad host',
      }),
    ).toThrow('CLAMAV_HOST_invalid');
  });
});
