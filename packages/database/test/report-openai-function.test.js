import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  REPORT_MODEL,
  estimateReportCostCents,
  validateReportProviderResponse,
} from '../../../supabase/functions/_shared/report-openai.js';

const edgeFunction = readFileSync(
  new URL(
    '../../../supabase/functions/report-openai-proposal/index.js',
    import.meta.url,
  ),
  'utf8',
);

function providerBody(overrides = {}) {
  return {
    model: REPORT_MODEL,
    output: [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({
              groundingIds: ['job-1', 'approval-1'],
              requiresHumanApproval: true,
              status: 'proposed',
              summary: 'Trusted evidence prepared a draft for office review.',
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

describe('Report OpenAI Edge Function boundary', () => {
  it('accepts a grounded, matching, bounded response', () => {
    const reviewed = validateReportProviderResponse(
      providerBody(),
      'proposed',
      ['job-1', 'approval-1'],
    );
    expect(reviewed?.output.summary).toContain('office review');
    expect(reviewed?.estimatedCostCents).toBe(1);
  });

  it('rejects changed outcomes, invented identifiers, tools, and model drift', () => {
    expect(
      validateReportProviderResponse(providerBody(), 'escalated', [
        'job-1',
        'approval-1',
      ]),
    ).toBeUndefined();

    const invented = providerBody();
    invented.output[0].content[0].text = JSON.stringify({
      groundingIds: ['job-1', 'invented-id'],
      requiresHumanApproval: true,
      status: 'proposed',
      summary: 'Invented identifier.',
    });
    expect(
      validateReportProviderResponse(invented, 'proposed', [
        'job-1',
        'approval-1',
      ]),
    ).toBeUndefined();

    expect(
      validateReportProviderResponse(
        providerBody({ output: [{ type: 'function_call' }] }),
        'proposed',
        ['job-1', 'approval-1'],
      ),
    ).toBeUndefined();
    expect(
      validateReportProviderResponse(
        providerBody({ model: 'unexpected-model' }),
        'proposed',
        ['job-1', 'approval-1'],
      ),
    ).toBeUndefined();
  });

  it('rejects excessive usage and calculates conservative whole-cent cost', () => {
    expect(estimateReportCostCents(120, 45)).toBe(1);
    expect(
      validateReportProviderResponse(
        providerBody({ usage: { input_tokens: 4001, output_tokens: 45 } }),
        'proposed',
        ['job-1', 'approval-1'],
      ),
    ).toBeUndefined();
  });

  it('uses strict no-tool requests for both trusted Report policies', () => {
    expect(edgeFunction).toContain('store: false');
    expect(edgeFunction).toContain('tools: []');
    expect(edgeFunction).toContain('strict: true');
    expect(edgeFunction).toContain("rpc: 'request_report_proposal'");
    expect(edgeFunction).toContain("rpc: 'request_report_invoice_proposal'");
    expect(edgeFunction).toContain("'record_report_provider_review'");
    expect(edgeFunction).not.toMatch(
      /(?:INSERT|UPDATE)\s+(?:INTO\s+)?public\.(?:work_reports|invoices)/i,
    );
  });
});
