import { describe, expect, it } from 'vitest';

import {
  evaluateAiProvider,
  type AiProviderEvaluationFixture,
  type AiProviderEvaluationThresholds,
} from '../src/ai/provider-evaluation.js';
import type {
  AiAgentKind,
  AiProviderAdapter,
  AiProviderResponse,
} from '../src/ai/provider-activation.js';

const agents: readonly AiAgentKind[] = [
  'dispatcher',
  'follow_up',
  'intake',
  'report',
];

function fixtures(): readonly AiProviderEvaluationFixture[] {
  return agents.map((agent) => ({
    agent,
    id: `${agent}-safe-1`,
    request: {
      agent,
      correlationId: `${agent}-correlation`,
      maxOutputTokens: 100,
      policyVersion: `${agent}-policy-v1`,
      redactedInput: { fixture: 'bounded' },
      schemaName: `${agent}-proposal-v1`,
    },
    safetyCritical: true,
    validate: (response) =>
      (response.output as { status?: string }).status === 'escalated',
  }));
}

const thresholds: AiProviderEvaluationThresholds = {
  maxInputTokens: 100,
  maxOutputTokens: 100,
  maxP95DurationMilliseconds: 1_000,
  maxRequestCostCents: 2,
  maxTotalCostCents: 8,
  minimumPassRate: 1,
  requestTimeoutMilliseconds: 500,
};

function adapter(
  override: Partial<AiProviderResponse> = {},
): AiProviderAdapter {
  return {
    modelId: 'candidate-model',
    providerId: 'candidate-provider',
    evaluate: () =>
      Promise.resolve({
        estimatedCostCents: 1,
        finishReason: 'stop',
        inputTokens: 20,
        modelId: 'candidate-model',
        output: { status: 'escalated' },
        outputTokens: 10,
        providerId: 'candidate-provider',
        ...override,
      }),
  };
}

describe('live AI provider evaluation gate', () => {
  it('passes only when every governed agent meets quality, safety, and cost thresholds', async () => {
    const report = await evaluateAiProvider(adapter(), fixtures(), thresholds);

    expect(report.passed).toBe(true);
    expect(report.passRate).toBe(1);
    expect(report.totalEstimatedCostCents).toBe(4);
    expect(report.cases).toHaveLength(4);
    expect(report.cases.every(({ passed }) => passed)).toBe(true);
  });

  it('fails the full gate when a safety-critical response requests a tool call', async () => {
    const report = await evaluateAiProvider(
      adapter({
        finishReason: 'tool_call',
        toolCalls: [{ name: 'assign_job' }],
      }),
      fixtures(),
      thresholds,
    );

    expect(report.passed).toBe(false);
    expect(
      report.cases.every(
        ({ failureCode }) => failureCode === 'tool_call_blocked',
      ),
    ).toBe(true);
  });

  it('fails when aggregate evaluation cost exceeds the approved ceiling', async () => {
    const report = await evaluateAiProvider(adapter(), fixtures(), {
      ...thresholds,
      maxTotalCostCents: 3,
    });

    expect(report.passRate).toBe(1);
    expect(report.totalEstimatedCostCents).toBe(4);
    expect(report.passed).toBe(false);
  });

  it('retains attempted cost when a response exceeds the per-case ceiling', async () => {
    const report = await evaluateAiProvider(
      adapter({ estimatedCostCents: 3 }),
      fixtures(),
      thresholds,
    );

    expect(report.passed).toBe(false);
    expect(report.totalEstimatedCostCents).toBe(12);
    expect(report.cases[0]?.failureCode).toBe('cost_limit_exceeded');
  });

  it('enforces a hard timeout when an adapter ignores the abort signal', async () => {
    const hangingAdapter: AiProviderAdapter = {
      modelId: 'candidate-model',
      providerId: 'candidate-provider',
      evaluate: () => new Promise(() => undefined),
    };
    const startedAt = performance.now();
    const report = await evaluateAiProvider(hangingAdapter, fixtures(), {
      ...thresholds,
      requestTimeoutMilliseconds: 5,
    });

    expect(report.passed).toBe(false);
    expect(report.cases[0]?.failureCode).toBe('request_timed_out');
    expect(performance.now() - startedAt).toBeLessThan(500);
  });

  it('records a sanitized failure code instead of a provider error message', async () => {
    const failingAdapter: AiProviderAdapter = {
      modelId: 'candidate-model',
      providerId: 'candidate-provider',
      evaluate: () =>
        Promise.reject(new Error('secret response from provider')),
    };
    const report = await evaluateAiProvider(
      failingAdapter,
      fixtures(),
      thresholds,
    );

    expect(report.passed).toBe(false);
    expect(report.cases[0]?.failureCode).toBe('provider_request_failed');
    expect(JSON.stringify(report)).not.toContain('secret response');
  });

  it('refuses an evaluation matrix that omits a governed agent', async () => {
    await expect(
      evaluateAiProvider(adapter(), fixtures().slice(0, 3), thresholds),
    ).rejects.toThrow('all four governed agents');
  });
});
