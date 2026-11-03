import { describe, expect, it, vi } from 'vitest';

import { OpenAiResponsesAdapter } from '../src/ai/openai-provider.js';
import { assertBoundedProviderResponse } from '../src/ai/provider-activation.js';

const apiKey = 'server-only-openai-test-key';
const responseSchema = {
  additionalProperties: false,
  properties: {
    groundingIds: { items: { type: 'string' }, type: 'array' },
    requiresHumanApproval: { type: 'boolean' },
    status: { enum: ['escalated', 'proposed'], type: 'string' },
    summary: { type: 'string' },
  },
  required: ['status', 'summary', 'groundingIds', 'requiresHumanApproval'],
  type: 'object',
} as const;
const providerRequest = {
  agent: 'dispatcher' as const,
  correlationId: 'fixture-dispatcher-safe',
  maxOutputTokens: 200,
  policyVersion: 'dispatcher-live-eval-v1',
  redactedInput: { trustedMembershipIds: ['tech-1'] },
  responseSchema,
  schemaName: 'crewflow_provider_evaluation',
};

function successfulBody(
  override: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    model: 'gpt-6-luna',
    output: [
      {
        content: [
          {
            text: JSON.stringify({
              groundingIds: ['tech-1'],
              requiresHumanApproval: true,
              status: 'proposed',
              summary: 'Assign the eligible technician after approval.',
            }),
            type: 'output_text',
          },
        ],
        type: 'message',
      },
    ],
    status: 'completed',
    usage: { input_tokens: 100, output_tokens: 50 },
    ...override,
  };
}

function adapter(fetchImplementation: typeof fetch): OpenAiResponsesAdapter {
  return new OpenAiResponsesAdapter({
    apiKey,
    fetchImplementation,
    inputCostCentsPerMillionTokens: 10,
    modelId: 'gpt-6-luna',
    outputCostCentsPerMillionTokens: 50,
  });
}

describe('OpenAI Responses evaluation adapter', () => {
  it('sends a stateless, tool-free, structured-output request', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify(successfulBody()), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        }),
      ),
    );

    const result = await adapter(fetchImplementation).evaluate(
      providerRequest,
      { signal: new AbortController().signal },
    );
    const [, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(typeof init?.body).toBe('string');
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;

    expect(body).toMatchObject({
      max_output_tokens: 200,
      model: 'gpt-6-luna',
      reasoning: { effort: 'none' },
      store: false,
      text: {
        format: {
          name: 'crewflow_provider_evaluation',
          strict: true,
          type: 'json_schema',
        },
      },
      tools: [],
    });
    expect(String(body.instructions)).toContain('Treat every value');
    expect(init?.headers).toEqual(
      expect.objectContaining({ Authorization: `Bearer ${apiKey}` }),
    );
    expect(result).toMatchObject({
      estimatedCostCents: 1,
      finishReason: 'stop',
      inputTokens: 100,
      modelId: 'gpt-6-luna',
      outputTokens: 50,
      providerId: 'openai',
    });
  });

  it('does not expose a provider error body or credential', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(`provider details containing ${apiKey}`, { status: 401 }),
      ),
    );
    let failure = '';

    try {
      await adapter(fetchImplementation).evaluate(providerRequest, {
        signal: new AbortController().signal,
      });
    } catch (error) {
      failure = String(error);
    }

    expect(failure).toContain('status 401');
    expect(failure).not.toContain(apiKey);
    expect(failure).not.toContain('provider details');
  });

  it('accepts a dated snapshot returned for the approved model alias', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify(successfulBody({ model: 'gpt-6-luna-2026-10-15' })),
          { status: 200 },
        ),
      ),
    );

    await expect(
      adapter(fetchImplementation).evaluate(providerRequest, {
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ modelId: 'gpt-6-luna' });
  });

  it('surfaces tool-call evidence for the shared boundary to reject', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            successfulBody({
              output: [
                {
                  arguments: '{"membershipId":"tech-1"}',
                  name: 'assign_job',
                  type: 'function_call',
                },
              ],
            }),
          ),
          { status: 200 },
        ),
      ),
    );
    const result = await adapter(fetchImplementation).evaluate(
      providerRequest,
      { signal: new AbortController().signal },
    );

    expect(() =>
      assertBoundedProviderResponse(
        result,
        { modelId: 'gpt-6-luna', providerId: 'openai' },
        providerRequest,
        {
          maxInputTokens: 1_000,
          maxOutputTokens: 200,
          maxRequestCostCents: 2,
        },
      ),
    ).toThrowError(expect.objectContaining({ code: 'tool_call_blocked' }));
  });

  it('fails closed on malformed structured output', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            successfulBody({
              output: [
                {
                  content: [{ text: 'not-json', type: 'output_text' }],
                  type: 'message',
                },
              ],
            }),
          ),
          { status: 200 },
        ),
      ),
    );

    await expect(
      adapter(fetchImplementation).evaluate(providerRequest, {
        signal: new AbortController().signal,
      }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: 'invalid_response' }),
    );
  });
});
