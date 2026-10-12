import { describe, expect, it } from 'vitest';

import { HealthController } from '../src/health.controller.js';

describe('HealthController', () => {
  it('returns a stable readiness payload', () => {
    expect(new HealthController().getHealth()).toEqual({
      service: 'crewflow-api',
      status: 'ok',
      version: 'v1',
    });
  });
});
