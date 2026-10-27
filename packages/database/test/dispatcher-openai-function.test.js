import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DISPATCHER_MODEL,
  estimateDispatcherCostCents,
  validateDispatcherProviderResponse,
} from '../../../supabase/functions/_shared/dispatcher-openai.js';

const edgeFunction = readFileSync(
  new URL(
    '../../../supabase/functions/dispatcher-openai-proposal/index.js',
    import.meta.url,
  ),
  'utf8',
);

function providerBody(overrides = {}) {
  return {
    model: DISPATCHER_MODEL,
    output: [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({
              groundingIds: ['job-1', 'tech-1'],
              requiresHumanApproval: true,
              status: 'proposed',
              summary: 'Trusted eligibility checks selected the technician.',
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

describe('Dispatcher OpenAI Edge Function boundary', () => {
  it('accepts a grounded, matching, bounded response', () => {
    const reviewed = validateDispatcherProviderResponse(
      providerBody(),
      'proposed',
      ['job-1', 'tech-1'],
    );
    expect(reviewed?.output.summary).toContain('eligibility checks');
    expect(reviewed?.estimatedCostCents).toBe(1);
  });

  it('rejects changed outcomes, invented identifiers, tools, and model drift', () => {
    expect(
      validateDispatcherProviderResponse(providerBody(), 'escalated', [
        'job-1',
        'tech-1',
      ]),
    ).toBeUndefined();

    const invented = providerBody();
    invented.output[0].content[0].text = JSON.stringify({
      groundingIds: ['job-1', 'tech-invented'],
      requiresHumanApproval: true,
      status: 'proposed',
      summary: 'Invented technician.',
    });
    expect(
      validateDispatcherProviderResponse(invented, 'proposed', [
        'job-1',
        'tech-1',
      ]),
    ).toBeUndefined();

    expect(
      validateDispatcherProviderResponse(
        providerBody({ output: [{ type: 'function_call' }] }),
        'proposed',
        ['job-1', 'tech-1'],
      ),
    ).toBeUndefined();
    expect(
      validateDispatcherProviderResponse(
        providerBody({ model: 'unexpected-model' }),
        'proposed',
        ['job-1', 'tech-1'],
      ),
    ).toBeUndefined();
  });

  it('rejects excessive usage and calculates conservative whole-cent cost', () => {
    expect(estimateDispatcherCostCents(120, 45)).toBe(1);
    expect(
      validateDispatcherProviderResponse(
        providerBody({ usage: { input_tokens: 4001, output_tokens: 45 } }),
        'proposed',
        ['job-1', 'tech-1'],
      ),
    ).toBeUndefined();
  });

  it('uses strict no-tool non-retained Responses API requests', () => {
    expect(edgeFunction).toContain('store: false');
    expect(edgeFunction).toContain('tools: []');
    expect(edgeFunction).toContain('strict: true');
    expect(edgeFunction).toContain("type: 'json_schema'");
    expect(edgeFunction).toContain("'request_dispatcher_proposal'");
    expect(edgeFunction).toContain("'record_dispatcher_provider_review'");
    expect(edgeFunction).not.toMatch(/UPDATE\s+public\.jobs/i);
  });
});
