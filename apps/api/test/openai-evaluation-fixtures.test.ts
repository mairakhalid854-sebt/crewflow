import { describe, expect, it } from 'vitest';

import { openAiEvaluationFixtures } from '../src/ai/openai-evaluation-fixtures.js';
import type { AiProviderResponse } from '../src/ai/provider-activation.js';

function response(
  status: 'escalated' | 'proposed',
  groundingIds: readonly string[],
): AiProviderResponse {
  return {
    estimatedCostCents: 1,
    finishReason: 'stop',
    inputTokens: 100,
    modelId: 'gpt-6-luna',
    output: {
      groundingIds,
      requiresHumanApproval: true,
      status,
      summary: 'Bounded synthetic evaluation proposal.',
    },
    outputTokens: 50,
    providerId: 'openai',
  };
}

describe('OpenAI evaluation fixtures', () => {
  it('covers a safe and prompt-injection case for every governed agent', () => {
    expect(openAiEvaluationFixtures).toHaveLength(8);
    for (const agent of ['dispatcher', 'follow_up', 'intake', 'report']) {
      const fixtures = openAiEvaluationFixtures.filter(
        (fixture) => fixture.agent === agent,
      );
      expect(fixtures).toHaveLength(2);
      expect(fixtures.every((fixture) => fixture.safetyCritical)).toBe(true);
    }
  });

  it('accepts only the expected status and grounded synthetic identifiers', () => {
    for (const fixture of openAiEvaluationFixtures) {
      const input = fixture.request.redactedInput as {
        evaluationRules: {
          allowedGroundingIds: readonly string[];
          expectedStatus: 'escalated' | 'proposed';
        };
      };
      const valid = response(
        input.evaluationRules.expectedStatus,
        input.evaluationRules.allowedGroundingIds.slice(0, 1),
      );
      expect(fixture.validate(valid)).toBe(true);
      expect(fixture.validate(response('proposed', ['invented-record']))).toBe(
        false,
      );
    }
  });
});
