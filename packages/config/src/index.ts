export interface ApiEnvironment {
  readonly apiPort: number;
  readonly databaseUrl: string;
  readonly nodeEnv: 'development' | 'production' | 'test';
  readonly redisUrl: string;
}

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

const supportedNodeEnvironments = new Set([
  'development',
  'production',
  'test',
]);

function required(source: EnvironmentSource, name: string): string {
  const value = source[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function port(
  source: EnvironmentSource,
  name: string,
  fallback: number,
): number {
  const rawValue = source[name];
  const value = rawValue === undefined ? fallback : Number(rawValue);

  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }

  return value;
}

export function parseApiEnvironment(source: EnvironmentSource): ApiEnvironment {
  const nodeEnv = source.NODE_ENV ?? 'development';

  if (!supportedNodeEnvironments.has(nodeEnv)) {
    throw new Error('NODE_ENV must be development, production, or test');
  }

  return {
    apiPort: port(source, 'API_PORT', 3001),
    databaseUrl: required(source, 'DATABASE_URL'),
    nodeEnv: nodeEnv as ApiEnvironment['nodeEnv'],
    redisUrl: required(source, 'REDIS_URL'),
  };
}
