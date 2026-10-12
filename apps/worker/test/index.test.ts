import { describe, expect, it } from 'vitest';

import { getWorkerIdentity } from '../src/index.js';

describe('worker foundation', () => {
  it('has no external side effects before a queue adapter is configured', () => {
    expect(getWorkerIdentity()).toEqual({
      service: 'crewflow-worker',
      status: 'idle',
    });
  });
});
