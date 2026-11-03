import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  INTAKE_MODEL,
  estimateIntakeCostCents,
  validateIntakeProviderResponse,
} from '../../../supabase/functions/_shared/intake-openai.js';

const edgeFunction = readFileSync(
  new URL(
    '../../../supabase/functions/intake-openai-proposal/index.js',
    import.meta.url,
  ),
  'utf8',
);

function providerBody(overrides = {}) {
  return {
    model: INTAKE_MODEL,
    output: [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({
              groundingIds: ['conversation-1', 'approval-1'],
              requiresHumanApproval: true,
              status: 'proposed',
              summary: 'Trusted checks prepared a proposal for office review.',
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

describe('Intake OpenAI Edge Function boundary', () => {
  it('accepts a grounded, matching, bounded response', () => {
    const reviewed = validateIntakeProviderResponse(
      providerBody(),
      'proposed',
      ['conversation-1', 'approval-1'],
    );
    expect(reviewed?.output.summary).toContain('office review');
    expect(reviewed?.estimatedCostCents).toBe(1);
  });

  it('rejects changed outcomes, invented identifiers, tools, and model drift', () => {
    expect(
      validateIntakeProviderResponse(providerBody(), 'escalated', [
        'conversation-1',
        'approval-1',
      ]),
    ).toBeUndefined();

    const invented = providerBody();
    invented.output[0].content[0].text = JSON.stringify({
      groundingIds: ['conversation-1', 'invented-id'],
      requiresHumanApproval: true,
      status: 'proposed',
      summary: 'Invented identifier.',
    });
    expect(
      validateIntakeProviderResponse(invented, 'proposed', [
        'conversation-1',
        'approval-1',
      ]),
    ).toBeUndefined();

    expect(
      validateIntakeProviderResponse(
        providerBody({ output: [{ type: 'function_call' }] }),
        'proposed',
        ['conversation-1', 'approval-1'],
      ),
    ).toBeUndefined();
    expect(
      validateIntakeProviderResponse(
        providerBody({ model: 'unexpected-model' }),
        'proposed',
        ['conversation-1', 'approval-1'],
      ),
    ).toBeUndefined();
  });

  it('rejects excessive usage and calculates conservative whole-cent cost', () => {
    expect(estimateIntakeCostCents(120, 45)).toBe(1);
    expect(
      validateIntakeProviderResponse(
        providerBody({ usage: { input_tokens: 4001, output_tokens: 45 } }),
        'proposed',
        ['conversation-1', 'approval-1'],
      ),
    ).toBeUndefined();
  });

  it('uses strict no-tool non-retained Responses API requests', () => {
    expect(edgeFunction).toContain('store: false');
    expect(edgeFunction).toContain('tools: []');
    expect(edgeFunction).toContain('strict: true');
    expect(edgeFunction).toContain("type: 'json_schema'");
    expect(edgeFunction).toContain("'request_intake_quote_slot_proposal'");
    expect(edgeFunction).toContain("'record_intake_provider_review'");
    expect(edgeFunction).not.toMatch(
      /(?:INSERT|UPDATE)\s+(?:INTO\s+)?public\.(?:customers|jobs|quotes)/i,
    );
  });
});
