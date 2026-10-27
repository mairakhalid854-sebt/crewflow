export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export interface ScannerConfig {
  readonly authToken: string;
  readonly clamAvHost: string;
  readonly clamAvPort: number;
  readonly clamAvTimeoutMs: number;
  readonly host: string;
  readonly port: number;
}

function integerInRange(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (value === undefined || value.length === 0) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name}_invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name}_invalid`);
  }
  return parsed;
}

export function loadScannerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ScannerConfig {
  const authToken = environment.SCANNER_AUTH_TOKEN ?? '';
  if (authToken.length < 32 || authToken.length > 512) {
    throw new Error('SCANNER_AUTH_TOKEN_invalid');
  }

  const clamAvHost = environment.CLAMAV_HOST?.trim() || '127.0.0.1';
  if (clamAvHost.length > 253 || /[\s/\\]/.test(clamAvHost)) {
    throw new Error('CLAMAV_HOST_invalid');
  }

  const host = environment.HOST?.trim() || '0.0.0.0';
  if (host.length > 253 || /[\s/\\]/.test(host)) {
    throw new Error('HOST_invalid');
  }

  return {
    authToken,
    clamAvHost,
    clamAvPort: integerInRange(
      environment.CLAMAV_PORT,
      3310,
      1,
      65_535,
      'CLAMAV_PORT',
    ),
    clamAvTimeoutMs: integerInRange(
      environment.CLAMAV_TIMEOUT_MS,
      15_000,
      1_000,
      30_000,
      'CLAMAV_TIMEOUT_MS',
    ),
    host,
    port: integerInRange(environment.PORT, 8080, 1, 65_535, 'PORT'),
  };
}
