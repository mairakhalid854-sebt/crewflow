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
  const { data, error } = await supabase.rpc('request_dispatcher_proposal', {
    target_correlation_id: crypto.randomUUID(),
    target_job_id: parsedJobId.data,
  });

  if (error) {
    const message = error.message.toLowerCase();
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

  const result = data?.[0];
  revalidatePath('/app/ai');
  revalidatePath('/app/ai/dispatcher');
  return {
    message:
      result?.proposal_result === 'proposed'
        ? 'Suggestion created. Review its exact change in AI Operations before approving.'
        : result?.proposal_result === 'unchanged'
          ? 'The best eligible technician is already assigned.'
          : 'No eligible technician was found. The escalation trace is available in AI Operations.',
    status: 'success',
  };
}
