import {
  AiProviderBoundaryError,
  assertBoundedProviderResponse,
  type AiAgentKind,
  type AiProviderAdapter,
  type AiProviderRequest,
  type AiProviderResponse,
} from './provider-activation.ts';

export interface AiProviderEvaluationFixture {
  readonly agent: AiAgentKind;
  readonly id: string;
  readonly request: AiProviderRequest;
  readonly safetyCritical: boolean;
  validate(response: AiProviderResponse): boolean;
}

export interface AiProviderEvaluationThresholds {
  readonly maxInputTokens: number;
  readonly maxOutputBytes?: number;
  readonly maxOutputTokens: number;
  readonly maxP95DurationMilliseconds: number;
  readonly maxRequestCostCents: number;
  readonly maxTotalCostCents: number;
  readonly minimumPassRate: number;
  readonly requestTimeoutMilliseconds: number;
}

export interface AiProviderEvaluationCaseResult {
  readonly agent: AiAgentKind;
  readonly durationMilliseconds: number;
  readonly estimatedCostCents: number;
  readonly failureCode?: string;
  readonly id: string;
  readonly passed: boolean;
}

export interface AiProviderEvaluationReport {
  readonly cases: readonly AiProviderEvaluationCaseResult[];
  readonly modelId: string;
  readonly p95DurationMilliseconds: number;
  readonly passRate: number;
  readonly passed: boolean;
  readonly providerId: string;
  readonly totalEstimatedCostCents: number;
}

const requiredAgents: readonly AiAgentKind[] = [
  'dispatcher',
  'follow_up',
  'intake',
  'report',
];

function validateEvaluationInputs(
  fixtures: readonly AiProviderEvaluationFixture[],
  thresholds: AiProviderEvaluationThresholds,
): void {
  if (
    !fixtures.length ||
    new Set(fixtures.map(({ id }) => id)).size !== fixtures.length
  ) {
    throw new AiProviderBoundaryError(
      'invalid_configuration',
      'Provider evaluation fixtures must have unique identifiers.',
    );
  }
  if (
    requiredAgents.some(
      (agent) => !fixtures.some((fixture) => fixture.agent === agent),
    )
  ) {
    throw new AiProviderBoundaryError(
      'invalid_configuration',
      'Provider evaluation must cover all four governed agents.',
    );
  }
  if (
    thresholds.minimumPassRate < 0 ||
    thresholds.minimumPassRate > 1 ||
    !Number.isFinite(thresholds.minimumPassRate)
  ) {
    throw new AiProviderBoundaryError(
      'invalid_configuration',
      'Provider evaluation pass rate must be between zero and one.',
    );
  }
  const positiveIntegers = [
    thresholds.maxInputTokens,
    thresholds.maxOutputTokens,
    thresholds.maxP95DurationMilliseconds,
    thresholds.maxRequestCostCents,
    thresholds.requestTimeoutMilliseconds,
  ];
  if (
    positiveIntegers.some(
      (value) => !Number.isSafeInteger(value) || value <= 0,
    ) ||
    !Number.isSafeInteger(thresholds.maxTotalCostCents) ||
    thresholds.maxTotalCostCents < 0
  ) {
    throw new AiProviderBoundaryError(
      'invalid_configuration',
      'Provider evaluation thresholds must be bounded integers.',
    );
  }
  if (
    thresholds.maxOutputBytes !== undefined &&
    (!Number.isSafeInteger(thresholds.maxOutputBytes) ||
      thresholds.maxOutputBytes <= 0)
  ) {
    throw new AiProviderBoundaryError(
      'invalid_configuration',
      'Provider output-byte threshold must be a positive integer.',
    );
  }
  if (fixtures.some((fixture) => fixture.agent !== fixture.request.agent)) {
    throw new AiProviderBoundaryError(
      'invalid_configuration',
      'Provider evaluation fixture and request agents must match.',
    );
  }
}

function percentile95(values: readonly number[]): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1] ?? 0;
}

function safeFailureCode(error: unknown): string {
  return error instanceof AiProviderBoundaryError
    ? error.code
    : 'provider_request_failed';
}

function requestWithTimeout(
  adapter: AiProviderAdapter,
  request: AiProviderRequest,
  timeoutMilliseconds: number,
): Promise<AiProviderResponse> {
  const controller = new AbortController();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      controller.abort();
      reject(
        new AiProviderBoundaryError(
          'request_timed_out',
          'The AI provider request exceeded its timeout.',
        ),
      );
    }, timeoutMilliseconds);

    Promise.resolve()
      .then(() => adapter.evaluate(request, { signal: controller.signal }))
      .then(resolve, reject)
      .finally(() => clearTimeout(timeout));
  });
}

export async function evaluateAiProvider(
  adapter: AiProviderAdapter,
  fixtures: readonly AiProviderEvaluationFixture[],
  thresholds: AiProviderEvaluationThresholds,
): Promise<AiProviderEvaluationReport> {
  validateEvaluationInputs(fixtures, thresholds);
  const caseResults: AiProviderEvaluationCaseResult[] = [];

  for (const fixture of fixtures) {
    const startedAt = performance.now();
    let estimatedCostCents = 0;

    try {
      const untrustedResponse = await requestWithTimeout(
        adapter,
        fixture.request,
        thresholds.requestTimeoutMilliseconds,
      );
      if (
        Number.isSafeInteger(untrustedResponse.estimatedCostCents) &&
        untrustedResponse.estimatedCostCents >= 0
      ) {
        estimatedCostCents = untrustedResponse.estimatedCostCents;
      }
      const response = assertBoundedProviderResponse(
        untrustedResponse,
        adapter,
        fixture.request,
        thresholds,
      );
      const passed = fixture.validate(response);
      caseResults.push({
        agent: fixture.agent,
        durationMilliseconds: Math.ceil(performance.now() - startedAt),
        estimatedCostCents,
        failureCode: passed ? undefined : 'quality_threshold_failed',
        id: fixture.id,
        passed,
      });
    } catch (error) {
      caseResults.push({
        agent: fixture.agent,
        durationMilliseconds: Math.ceil(performance.now() - startedAt),
        estimatedCostCents,
        failureCode: safeFailureCode(error),
        id: fixture.id,
        passed: false,
      });
    }
  }

  const totalEstimatedCostCents = caseResults.reduce(
    (total, result) => total + result.estimatedCostCents,
    0,
  );
  const passRate =
    caseResults.filter(({ passed }) => passed).length / caseResults.length;
  const p95DurationMilliseconds = percentile95(
    caseResults.map(({ durationMilliseconds }) => durationMilliseconds),
  );
  const safetyCasesPassed = fixtures.every(
    (fixture, index) => !fixture.safetyCritical || caseResults[index]?.passed,
  );

  return {
    cases: caseResults,
    modelId: adapter.modelId,
    p95DurationMilliseconds,
    passRate,
    passed:
      safetyCasesPassed &&
      passRate >= thresholds.minimumPassRate &&
      p95DurationMilliseconds <= thresholds.maxP95DurationMilliseconds &&
      totalEstimatedCostCents <= thresholds.maxTotalCostCents,
    providerId: adapter.providerId,
    totalEstimatedCostCents,
  };
}
