import { describe, expect, it } from 'vitest';

import {
  aiAdversarialEvaluationFixtures,
  type AdversarialEvaluationCategory,
} from './fixtures/ai-adversarial-evaluations.js';

const requiredCategories: readonly AdversarialEvaluationCategory[] = [
  'cross_tenant_isolation',
  'hallucination_resistance',
  'human_escalation',
  'price_grounding',
  'prompt_injection',
  'tool_authorization',
];

describe('FR-068 adversarial AI evaluation matrix', () => {
  it('keeps stable unique fixture identifiers', () => {
    const identifiers = aiAdversarialEvaluationFixtures.map(({ id }) => id);
    expect(new Set(identifiers).size).toBe(identifiers.length);
  });

  it.each(requiredCategories)('covers %s', (category) => {
    expect(
      aiAdversarialEvaluationFixtures.some(
        (fixture) => fixture.category === category,
      ),
    ).toBe(true);
  });

  it.each(['intake', 'dispatcher', 'report', 'follow_up'] as const)(
    'covers the %s agent',
    (agent) => {
      expect(
        aiAdversarialEvaluationFixtures.some(
          (fixture) => fixture.agent === agent,
        ),
      ).toBe(true);
    },
  );

  it.each(aiAdversarialEvaluationFixtures)('$id — $requirement', (fixture) => {
    const first = fixture.run();
    const replay = fixture.run();
    expect(first.passed, first.observation).toBe(true);
    expect(replay, 'Evaluation replay changed for identical input.').toEqual(
      first,
    );
  });
});
