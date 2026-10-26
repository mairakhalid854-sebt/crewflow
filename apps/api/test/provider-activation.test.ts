import { describe, expect, it } from 'vitest';

import {
  assertBoundedProviderResponse,
  readAiProviderActivationConfig,
  type AiProviderBoundaryError,
  type AiProviderRequest,
  type AiProviderResponse,
} from '../src/ai/provider-activation.js';

const request: AiProviderRequest = {
  agent: 'dispatcher',
  correlationId: 'evaluation-1',
  maxOutputTokens: 100,
  policyVersion: 'dispatcher-v1',
  redactedInput: { jobId: 'job-redacted' },
  schemaName: 'dispatcher-proposal-v1',
};

const response: AiProviderResponse = {
  estimatedCostCents: 1,
  finishReason: 'stop',
  inputTokens: 20,
  modelId: 'approved-model',
  output: { status: 'escalated' },
  outputTokens: 10,
  providerId: 'approved-provider',
};

const liveEnvironment = {
  CREWFLOW_AI_MAX_INPUT_TOKENS: '4000',
  CREWFLOW_AI_MAX_OUTPUT_TOKENS: '800',
  CREWFLOW_AI_MAX_REQUEST_COST_CENTS: '5',
  CREWFLOW_AI_MODEL_ID: 'approved-model',
  CREWFLOW_AI_PROVIDER_API_KEY: 'server-only-secret-value',
  CREWFLOW_AI_PROVIDER_ID: 'approved-provider',
  CREWFLOW_AI_PROVIDER_LIVE_APPROVED: 'true',
  CREWFLOW_AI_PROVIDER_MODE: 'live',
  CREWFLOW_AI_REQUEST_TIMEOUT_MS: '15000',
} as const;

describe('AI provider activation boundary', () => {
  it('defaults to the deterministic stub with no credential', () => {
    expect(readAiProviderActivationConfig({})).toEqual({
      mode: 'stub',
      modelId: 'deterministic-v1',
      providerId: 'stub',
    });
  });

  it('requires explicit deployment approval before live mode', () => {
    expect(() =>
      readAiProviderActivationConfig({
        ...liveEnvironment,
        CREWFLOW_AI_PROVIDER_LIVE_APPROVED: 'false',
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AiProviderBoundaryError>>({
        code: 'live_not_approved',
      }),
    );
  });

  it('accepts a bounded explicitly approved live configuration', () => {
    expect(readAiProviderActivationConfig(liveEnvironment)).toEqual(
      expect.objectContaining({
        maxRequestCostCents: 5,
        mode: 'live',
        modelId: 'approved-model',
        providerId: 'approved-provider',
      }),
    );
  });

  it('never includes the credential in a configuration error', () => {
    const secret = 'do-not-leak-this-provider-secret';
    let message = '';
    try {
      readAiProviderActivationConfig({
        ...liveEnvironment,
        CREWFLOW_AI_MAX_OUTPUT_TOKENS: 'unbounded',
        CREWFLOW_AI_PROVIDER_API_KEY: secret,
      });
    } catch (error) {
      message = String(error);
    }
    expect(message).not.toContain(secret);
  });

  it('accepts a complete proposal-only response inside every bound', () => {
    expect(
      assertBoundedProviderResponse(
        response,
        { modelId: 'approved-model', providerId: 'approved-provider' },
        request,
        {
          maxInputTokens: 100,
          maxOutputTokens: 100,
          maxRequestCostCents: 2,
        },
      ),
    ).toBe(response);
  });

  it.each([
    {
      code: 'tool_call_blocked',
      override: { finishReason: 'tool_call' as const, toolCalls: [{}] },
    },
    {
      code: 'cost_limit_exceeded',
      override: { estimatedCostCents: 3 },
    },
    {
      code: 'identity_mismatch',
      override: { modelId: 'unapproved-model' },
    },
    {
      code: 'output_limit_exceeded',
      override: { outputTokens: 101 },
    },
  ])('fails closed with $code', ({ code, override }) => {
    expect(() =>
      assertBoundedProviderResponse(
        { ...response, ...override },
        { modelId: 'approved-model', providerId: 'approved-provider' },
        request,
        {
          maxInputTokens: 100,
          maxOutputTokens: 100,
          maxRequestCostCents: 2,
        },
      ),
    ).toThrowError(expect.objectContaining({ code }));
  });
});
