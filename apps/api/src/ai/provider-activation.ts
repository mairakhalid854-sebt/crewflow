export type AiAgentKind = 'dispatcher' | 'follow_up' | 'intake' | 'report';

export type AiJsonValue =
  | boolean
  | number
  | string
  | null
  | readonly AiJsonValue[]
  | { readonly [key: string]: AiJsonValue };

export interface AiProviderRequest {
  readonly agent: AiAgentKind;
  readonly correlationId: string;
  readonly maxOutputTokens: number;
  readonly policyVersion: string;
  readonly redactedInput: AiJsonValue;
  readonly schemaName: string;
}

export interface AiProviderResponse {
  readonly estimatedCostCents: number;
  readonly finishReason: 'content_filtered' | 'length' | 'stop' | 'tool_call';
  readonly inputTokens: number;
  readonly modelId: string;
  readonly output: AiJsonValue;
  readonly outputTokens: number;
  readonly providerId: string;
  readonly toolCalls?: readonly AiJsonValue[];
}

export interface AiProviderAdapter {
  readonly modelId: string;
  readonly providerId: string;
  evaluate(
    request: AiProviderRequest,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<AiProviderResponse>;
}

export type AiProviderMode = 'evaluation' | 'live' | 'stub';

export type AiProviderActivationConfig =
  | {
      readonly mode: 'stub';
      readonly modelId: 'deterministic-v1';
      readonly providerId: 'stub';
    }
  | {
      readonly apiKey: string;
      readonly maxInputTokens: number;
      readonly maxOutputTokens: number;
      readonly maxRequestCostCents: number;
      readonly mode: 'evaluation' | 'live';
      readonly modelId: string;
      readonly providerId: string;
      readonly requestTimeoutMilliseconds: number;
    };

export type AiProviderBoundaryErrorCode =
  | 'cost_limit_exceeded'
  | 'identity_mismatch'
  | 'invalid_configuration'
  | 'invalid_response'
  | 'live_not_approved'
  | 'output_limit_exceeded'
  | 'request_timed_out'
  | 'tool_call_blocked';

export class AiProviderBoundaryError extends Error {
  readonly code: AiProviderBoundaryErrorCode;

  constructor(code: AiProviderBoundaryErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'AiProviderBoundaryError';
  }
}

const identifierPattern = /^[a-z0-9][a-z0-9._-]{0,79}$/;

function requiredIdentifier(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
): string {
  const value = environment[key]?.trim();
  if (!value || !identifierPattern.test(value)) {
    throw new AiProviderBoundaryError(
      'invalid_configuration',
      `${key} must be a bounded lowercase provider identifier.`,
    );
  }
  return value;
}

function requiredInteger(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
  minimum: number,
  maximum: number,
): number {
  const raw = environment[key]?.trim();
  if (!raw || !/^\d+$/.test(raw)) {
    throw new AiProviderBoundaryError(
      'invalid_configuration',
      `${key} must be an integer.`,
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new AiProviderBoundaryError(
      'invalid_configuration',
      `${key} is outside the allowed range.`,
    );
  }
  return value;
}

export function readAiProviderActivationConfig(
  environment: Readonly<Record<string, string | undefined>>,
): AiProviderActivationConfig {
  const mode = environment.CREWFLOW_AI_PROVIDER_MODE?.trim() || 'stub';
  if (mode === 'stub') {
    return {
      mode: 'stub',
      modelId: 'deterministic-v1',
      providerId: 'stub',
    };
  }
  if (mode !== 'evaluation' && mode !== 'live') {
    throw new AiProviderBoundaryError(
      'invalid_configuration',
      'CREWFLOW_AI_PROVIDER_MODE is not supported.',
    );
  }
  if (
    mode === 'live' &&
    environment.CREWFLOW_AI_PROVIDER_LIVE_APPROVED !== 'true'
  ) {
    throw new AiProviderBoundaryError(
      'live_not_approved',
      'Live AI provider use requires an explicit deployment approval.',
    );
  }

  const apiKey = environment.CREWFLOW_AI_PROVIDER_API_KEY?.trim();
  if (!apiKey || apiKey.length < 16) {
    throw new AiProviderBoundaryError(
      'invalid_configuration',
      'A server-only AI provider credential is required.',
    );
  }

  return {
    apiKey,
    maxInputTokens: requiredInteger(
      environment,
      'CREWFLOW_AI_MAX_INPUT_TOKENS',
      1,
      32_000,
    ),
    maxOutputTokens: requiredInteger(
      environment,
      'CREWFLOW_AI_MAX_OUTPUT_TOKENS',
      1,
      8_000,
    ),
    maxRequestCostCents: requiredInteger(
      environment,
      'CREWFLOW_AI_MAX_REQUEST_COST_CENTS',
      1,
      1_000,
    ),
    mode,
    modelId: requiredIdentifier(environment, 'CREWFLOW_AI_MODEL_ID'),
    providerId: requiredIdentifier(environment, 'CREWFLOW_AI_PROVIDER_ID'),
    requestTimeoutMilliseconds: requiredInteger(
      environment,
      'CREWFLOW_AI_REQUEST_TIMEOUT_MS',
      1_000,
      120_000,
    ),
  };
}

function validUsageValue(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function assertBoundedProviderResponse(
  response: AiProviderResponse,
  adapter: Pick<AiProviderAdapter, 'modelId' | 'providerId'>,
  request: AiProviderRequest,
  limits: Readonly<{
    maxInputTokens: number;
    maxOutputBytes?: number;
    maxOutputTokens: number;
    maxRequestCostCents: number;
  }>,
): AiProviderResponse {
  if (
    response.providerId !== adapter.providerId ||
    response.modelId !== adapter.modelId
  ) {
    throw new AiProviderBoundaryError(
      'identity_mismatch',
      'The provider response identity did not match the selected adapter.',
    );
  }
  if (
    !validUsageValue(response.inputTokens) ||
    !validUsageValue(response.outputTokens) ||
    !validUsageValue(response.estimatedCostCents)
  ) {
    throw new AiProviderBoundaryError(
      'invalid_response',
      'The provider returned invalid usage metadata.',
    );
  }
  if (response.estimatedCostCents > limits.maxRequestCostCents) {
    throw new AiProviderBoundaryError(
      'cost_limit_exceeded',
      'The provider response exceeded the per-request cost limit.',
    );
  }
  if (
    response.inputTokens > limits.maxInputTokens ||
    response.outputTokens > limits.maxOutputTokens ||
    response.outputTokens > request.maxOutputTokens
  ) {
    throw new AiProviderBoundaryError(
      'output_limit_exceeded',
      'The provider response exceeded a token limit.',
    );
  }
  if (response.toolCalls?.length || response.finishReason === 'tool_call') {
    throw new AiProviderBoundaryError(
      'tool_call_blocked',
      'Live model tool calls are disabled; only bounded proposals are allowed.',
    );
  }
  if (response.finishReason !== 'stop') {
    throw new AiProviderBoundaryError(
      'invalid_response',
      'The provider did not return a complete bounded response.',
    );
  }

  const encodedOutput = JSON.stringify(response.output);
  if (
    encodedOutput === undefined ||
    Buffer.byteLength(encodedOutput, 'utf8') > (limits.maxOutputBytes ?? 65_536)
  ) {
    throw new AiProviderBoundaryError(
      'output_limit_exceeded',
      'The provider response exceeded the serialized output limit.',
    );
  }

  return response;
}
