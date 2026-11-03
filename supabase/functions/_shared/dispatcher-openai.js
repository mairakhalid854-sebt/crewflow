export const DISPATCHER_MODEL = 'gpt-6-luna';
export const DISPATCHER_MAX_INPUT_TOKENS = 4000;
export const DISPATCHER_MAX_OUTPUT_TOKENS = 300;
export const DISPATCHER_MAX_COST_CENTS = 2;

const INPUT_COST_CENTS_PER_MILLION_TOKENS = 10;
const OUTPUT_COST_CENTS_PER_MILLION_TOKENS = 50;

function safeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function estimateDispatcherCostCents(inputTokens, outputTokens) {
  return Math.ceil(
    (inputTokens * INPUT_COST_CENTS_PER_MILLION_TOKENS +
      outputTokens * OUTPUT_COST_CENTS_PER_MILLION_TOKENS) /
      1_000_000,
  );
}

export function dispatcherOutputText(body) {
  if (!Array.isArray(body?.output)) return undefined;
  for (const item of body.output) {
    if (item?.type !== 'message') continue;
    if (!Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        return content.text;
      }
    }
  }
  return undefined;
}

export function validateDispatcherProviderResponse(
  body,
  expectedStatus,
  allowedGroundingIds,
) {
  if (body?.status !== 'completed') return undefined;
  if (
    typeof body?.model !== 'string' ||
    (body.model !== DISPATCHER_MODEL &&
      !body.model.startsWith(`${DISPATCHER_MODEL}-`))
  ) {
    return undefined;
  }
  if (
    !Array.isArray(body.output) ||
    body.output.some(
      (item) => item?.type !== 'message' && item?.type !== 'reasoning',
    )
  ) {
    return undefined;
  }

  const inputTokens = safeInteger(body?.usage?.input_tokens);
  const outputTokens = safeInteger(body?.usage?.output_tokens);
  if (
    inputTokens === undefined ||
    outputTokens === undefined ||
    inputTokens > DISPATCHER_MAX_INPUT_TOKENS ||
    outputTokens > DISPATCHER_MAX_OUTPUT_TOKENS
  ) {
    return undefined;
  }

  let output;
  try {
    output = JSON.parse(dispatcherOutputText(body));
  } catch {
    return undefined;
  }
  const keys =
    output && typeof output === 'object' && !Array.isArray(output)
      ? Object.keys(output).sort()
      : [];
  const groundingIds = output?.groundingIds;
  const validOutput =
    keys.join(',') === 'groundingIds,requiresHumanApproval,status,summary' &&
    output.status === expectedStatus &&
    output.requiresHumanApproval === true &&
    typeof output.summary === 'string' &&
    output.summary.trim().length > 0 &&
    output.summary.length <= 300 &&
    Array.isArray(groundingIds) &&
    groundingIds.length > 0 &&
    groundingIds.length <= allowedGroundingIds.length &&
    new Set(groundingIds).size === groundingIds.length &&
    groundingIds.every(
      (value) =>
        typeof value === 'string' && allowedGroundingIds.includes(value),
    );
  if (!validOutput) return undefined;

  const estimatedCostCents = estimateDispatcherCostCents(
    inputTokens,
    outputTokens,
  );
  if (estimatedCostCents > DISPATCHER_MAX_COST_CENTS) return undefined;

  return {
    estimatedCostCents,
    inputTokens,
    output,
    outputTokens,
  };
}
