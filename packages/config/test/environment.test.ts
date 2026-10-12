import { describe, expect, it } from 'vitest';

import { parseApiEnvironment } from '../src/index.js';

const validEnvironment = {
  API_PORT: '4000',
  DATABASE_URL: 'postgresql://example.invalid/crewflow',
  NODE_ENV: 'test',
  REDIS_URL: 'redis://example.invalid:6379',
} as const;

describe('parseApiEnvironment', () => {
  it('parses an explicit safe environment', () => {
    expect(parseApiEnvironment(validEnvironment)).toEqual({
      apiPort: 4000,
      databaseUrl: validEnvironment.DATABASE_URL,
      nodeEnv: 'test',
      redisUrl: validEnvironment.REDIS_URL,
    });
  });

  it('fails closed when a server-side connection value is missing', () => {
    const incomplete = {
      API_PORT: validEnvironment.API_PORT,
      NODE_ENV: validEnvironment.NODE_ENV,
      REDIS_URL: validEnvironment.REDIS_URL,
    };

    expect(() => parseApiEnvironment(incomplete)).toThrow(
      'Missing required environment variable: DATABASE_URL',
    );
  });

  it('rejects an invalid port', () => {
    expect(() =>
      parseApiEnvironment({ ...validEnvironment, API_PORT: '70000' }),
    ).toThrow('API_PORT must be an integer between 1 and 65535');
  });
});
