'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireTenantContext } from '../../../../lib/auth/tenant-context';
import { createClient } from '../../../../lib/supabase/server';

export interface DispatcherRequestState {
  readonly message?: string;
  readonly status: 'idle' | 'error' | 'success';
}

const jobIdSchema = z.uuid();

interface DispatcherResult {
  readonly proposal_result: 'escalated' | 'proposed' | 'unchanged';
  readonly provider_reviewed: boolean;
}

function parseDispatcherResult(value: unknown): DispatcherResult | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    !['escalated', 'proposed', 'unchanged'].includes(
      String(candidate.proposal_result),
    ) ||
    typeof candidate.provider_reviewed !== 'boolean'
  ) {
    return undefined;
  }
  return candidate as unknown as DispatcherResult;
}

export async function requestDispatcherProposalAction(
  _previousState: DispatcherRequestState,
  formData: FormData,
): Promise<DispatcherRequestState> {
  await requireTenantContext(['owner', 'office']);
  const parsedJobId = jobIdSchema.safeParse(formData.get('jobId'));
  if (!parsedJobId.success) {
    return { message: 'Job could not be identified.', status: 'error' };
  }

  const supabase = await createClient();
  const correlationId = crypto.randomUUID();
  const invocation: unknown = await supabase.functions.invoke(
    'dispatcher-openai-proposal',
    {
      body: { correlationId, jobId: parsedJobId.data },
    },
  );
  const invoked = invocation as
    { data?: unknown; error?: unknown } | null | undefined;
  let result = invoked?.error
    ? undefined
    : parseDispatcherResult(invoked?.data);
  let fallbackError: { message: string } | null = null;

  if (!result) {
    const fallback = await supabase.rpc('request_dispatcher_proposal', {
      target_correlation_id: correlationId,
      target_job_id: parsedJobId.data,
    });
    fallbackError = fallback.error;
    const deterministic = fallback.data?.[0];
    if (deterministic) {
      result = parseDispatcherResult({
        ...deterministic,
        provider_reviewed: false,
      });
    }
  }

  if (fallbackError || !result) {
    const message = fallbackError?.message.toLowerCase() ?? '';
    return {
      message: message.includes('ai operations are disabled')
        ? 'Enable AI operations and set a positive monthly budget in Settings first.'
        : message.includes('monthly budget exhausted')
          ? 'The monthly AI budget is exhausted. Manual dispatch remains available.'
          : message.includes('zip')
            ? 'Add a valid customer service ZIP code before requesting a suggestion.'
            : message.includes('complete schedule')
              ? 'Add a complete job schedule before requesting a suggestion.'
              : 'Dispatcher could not evaluate this job. Refresh and try again.',
      status: 'error',
    };
  }

  revalidatePath('/app/ai');
  revalidatePath('/app/ai/dispatcher');
  return {
    message:
      result.proposal_result === 'proposed'
        ? result.provider_reviewed
          ? 'Suggestion and bounded AI review recorded. Review the exact change in AI Operations before approving.'
          : 'Suggestion created using trusted checks. AI review was unavailable, so the safe deterministic result was kept for human approval.'
        : result.proposal_result === 'unchanged'
          ? 'The best eligible technician is already assigned.'
          : result.provider_reviewed
            ? 'No eligible technician was found. The AI-reviewed escalation trace is available in AI Operations.'
            : 'No eligible technician was found. The trusted escalation trace is available in AI Operations.',
    status: 'success',
  };
}
