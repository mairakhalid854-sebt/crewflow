import {
  openAiEvaluationFixtures,
  openAiEvaluationThresholds,
} from './openai-evaluation-fixtures.ts';
import { OpenAiResponsesAdapter } from './openai-provider.ts';
import { evaluateAiProvider } from './provider-evaluation.ts';

const apiKey = process.env.CREWFLOW_AI_PROVIDER_API_KEY?.trim();
if (!apiKey) {
  throw new Error(
    'CREWFLOW_AI_PROVIDER_API_KEY must be available to the server-side evaluation process.',
  );
}

const modelId = process.env.CREWFLOW_AI_MODEL_ID?.trim() || 'gpt-6-luna';
const adapter = new OpenAiResponsesAdapter({
  apiKey,
  inputCostCentsPerMillionTokens: 10,
  modelId,
  outputCostCentsPerMillionTokens: 50,
});

const report = await evaluateAiProvider(
  adapter,
  openAiEvaluationFixtures,
  openAiEvaluationThresholds,
);

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
