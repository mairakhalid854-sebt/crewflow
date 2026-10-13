import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';

describe('API runtime guardrails', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  it('propagates correlation IDs and rate-limits repeated requests', async () => {
    const correlationId = '550e8400-e29b-41d4-a716-446655440000';
    const firstResponse = await fetch(`${baseUrl}/v1/health`, {
      headers: { 'x-correlation-id': correlationId },
    });

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get('x-correlation-id')).toBe(correlationId);
    expect(await firstResponse.json()).toEqual({
      service: 'crewflow-api',
      status: 'ok',
      version: 'v1',
    });

    const remaining = Number(
      firstResponse.headers.get('x-ratelimit-remaining'),
    );
    expect(remaining).toBe(119);

    let finalResponse = firstResponse;
    for (
      let requestNumber = 0;
      requestNumber <= remaining;
      requestNumber += 1
    ) {
      finalResponse = await fetch(`${baseUrl}/v1/health`);
    }

    expect(finalResponse.status).toBe(429);
    expect(finalResponse.headers.get('retry-after')).toBeTruthy();
    expect(finalResponse.headers.get('x-correlation-id')).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });
});
