'use server';

import {
  openAiEvaluationFixtures,
  openAiEvaluationThresholds,
} from '../../../../api/src/ai/openai-evaluation-fixtures.ts';
import { OpenAiResponsesAdapter } from '../../../../api/src/ai/openai-provider.ts';
import { evaluateAiProvider } from '../../../../api/src/ai/provider-evaluation.ts';
import { requireTenantContext } from '../../../lib/auth/tenant-context';

export interface ProviderEvaluationState {
  readonly message?: string;
  readonly report?: {
    readonly casesPassed: number;
    readonly casesRun: number;
    readonly modelId: string;
    readonly p95DurationMilliseconds: number;
    readonly totalEstimatedCostCents: number;
  };
  readonly status: 'error' | 'idle' | 'success';
}

function stagingEvaluationEnabled(): boolean {
  return (
    process.env.VERCEL_ENV === 'preview' &&
    process.env.VERCEL_GIT_COMMIT_REF === 'staging'
  );
}

export async function runProviderEvaluationAction(
  _previousState: ProviderEvaluationState,
): Promise<ProviderEvaluationState> {
  void _previousState;
  await requireTenantContext(['owner']);
  if (!stagingEvaluationEnabled()) {
    return {
      message: 'Provider evaluation is available only on the staging branch.',
      status: 'error',
    };
  }

  const apiKey = process.env.CREWFLOW_AI_PROVIDER_API_KEY?.trim();
  if (!apiKey) {
    return {
      message: 'The staging provider credential is not configured.',
      status: 'error',
    };
  }

  try {
    const adapter = new OpenAiResponsesAdapter({
      apiKey,
      inputCostCentsPerMillionTokens: 10,
      modelId: 'gpt-6-luna',
      outputCostCentsPerMillionTokens: 50,
    });
    const report = await evaluateAiProvider(
      adapter,
      openAiEvaluationFixtures,
      openAiEvaluationThresholds,
    );
    const casesPassed = report.cases.filter(({ passed }) => passed).length;
    const safeReport = {
      casesPassed,
      casesRun: report.cases.length,
      modelId: report.modelId,
      p95DurationMilliseconds: report.p95DurationMilliseconds,
      totalEstimatedCostCents: report.totalEstimatedCostCents,
    };

    return report.passed
      ? {
          message:
            'The candidate model passed every safety, quality, latency, and cost gate.',
          report: safeReport,
          status: 'success',
        }
      : {
          message:
            'The candidate model did not pass every activation gate. Live mode remains disabled.',
          report: safeReport,
          status: 'error',
        };
  } catch {
    return {
      message:
        'The provider evaluation could not complete. No live AI mode was enabled.',
      status: 'error',
    };
  }
}
