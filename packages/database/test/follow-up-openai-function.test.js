import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  FOLLOW_UP_MODEL,
  estimateFollowUpCostCents,
  validateFollowUpProviderResponse,
} from '../../../supabase/functions/_shared/follow-up-openai.js';

const edgeFunction = readFileSync(
  new URL(
    '../../../supabase/functions/process-follow-up-openai-reviews/index.js',
    import.meta.url,
  ),
  'utf8',
);

function providerBody(overrides = {}) {
  return {
    model: FOLLOW_UP_MODEL,
    output: [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({
              groundingIds: ['run-1', 'approval-1', 'message-1', 'invoice-1'],
              requiresHumanApproval: true,
              status: 'proposed',
              summary: 'Contact and milestone checks produced a proposal.',
            }),
          },
        ],
      },
    ],
    status: 'completed',
    usage: { input_tokens: 120, output_tokens: 45 },
    ...overrides,
  };
}

const ids = ['run-1', 'approval-1', 'message-1', 'invoice-1'];

describe('Follow-Up OpenAI worker boundary', () => {
  it('accepts a grounded, proposed, approval-required response', () => {
    const reviewed = validateFollowUpProviderResponse(providerBody(), ids);
    expect(reviewed?.output.summary).toContain('proposal');
    expect(reviewed?.estimatedCostCents).toBe(1);
  });

  it('rejects invented IDs, changed status, tools, and model drift', () => {
    const invented = providerBody();
    invented.output[0].content[0].text = JSON.stringify({
      groundingIds: ['run-1', 'invented-id'],
      requiresHumanApproval: true,
      status: 'proposed',
      summary: 'Invented identifier.',
    });
    expect(validateFollowUpProviderResponse(invented, ids)).toBeUndefined();

    const changed = providerBody();
    changed.output[0].content[0].text = JSON.stringify({
      groundingIds: ids,
      requiresHumanApproval: true,
      status: 'escalated',
      summary: 'Changed status.',
    });
    expect(validateFollowUpProviderResponse(changed, ids)).toBeUndefined();
    expect(
      validateFollowUpProviderResponse(
        providerBody({ output: [{ type: 'function_call' }] }),
        ids,
      ),
    ).toBeUndefined();
    expect(
      validateFollowUpProviderResponse(
        providerBody({ model: 'unexpected-model' }),
        ids,
      ),
    ).toBeUndefined();
  });

  it('rejects excessive usage and conservatively rounds cost', () => {
    expect(estimateFollowUpCostCents(120, 45)).toBe(1);
    expect(
      validateFollowUpProviderResponse(
        providerBody({ usage: { input_tokens: 4001, output_tokens: 45 } }),
        ids,
      ),
    ).toBeUndefined();
  });

  it('uses a service-authenticated durable no-tool worker', () => {
    expect(edgeFunction).toContain("request.headers.get('apikey')");
    expect(edgeFunction).toContain("'claim_follow_up_provider_reviews'");
    expect(edgeFunction).toContain("'retry_follow_up_provider_review'");
    expect(edgeFunction).toContain("'record_follow_up_provider_review'");
    expect(edgeFunction).toContain('store: false');
    expect(edgeFunction).toContain('tools: []');
    expect(edgeFunction).toContain('strict: true');
    expect(edgeFunction).not.toMatch(
      /(?:INSERT|UPDATE)\s+(?:INTO\s+)?public\.follow_up_messages/i,
    );
  });
});
