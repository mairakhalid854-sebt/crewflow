const DEFAULT_LIMIT = 120;
const DEFAULT_WINDOW_MS = 60_000;

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export interface RateLimitConfiguration {
  readonly limit: number;
  readonly ttl: number;
}

function boundedInteger(
  source: EnvironmentSource,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const rawValue = source[name];
  const value = rawValue === undefined ? fallback : Number(rawValue);

  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  }

  return value;
}

export function parseRateLimitConfiguration(
  source: EnvironmentSource,
): RateLimitConfiguration {
  return {
    limit: boundedInteger(
      source,
      'API_RATE_LIMIT_MAX',
      DEFAULT_LIMIT,
      1,
      10_000,
    ),
    ttl: boundedInteger(
      source,
      'API_RATE_LIMIT_WINDOW_MS',
      DEFAULT_WINDOW_MS,
      1_000,
      3_600_000,
    ),
  };
}
