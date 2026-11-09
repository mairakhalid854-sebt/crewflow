'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { createClient } from '../../../lib/supabase/server';

export interface AiAssistState {
  readonly message?: string;
  readonly status: 'idle' | 'error' | 'success';
}

const errorMessages: Readonly<Record<string, string>> = {
  ai_disabled:
    'AI operations are turned off. An owner can turn them on in Settings.',
  ai_unavailable:
    'The AI service did not answer. Please try again in a minute.',
  budget_exhausted:
    'This month’s AI budget is used up. An owner can raise it in Settings.',
  invalid_request: 'Please check the text and try again.',
  job_not_quotable: 'Quotes can only be drafted for new or quoted jobs.',
  no_catalog: 'Add services with prices to your price list first.',
};

async function invoke(
  name: string,
  body: Record<string, unknown>,
): Promise<{ data?: Record<string, unknown>; errorCode?: string }> {
  const supabase = await createClient();
  const result: unknown = await supabase.functions.invoke(name, { body });
  const invoked = result as
    | { data?: unknown; error?: { context?: Response } | null }
    | null
    | undefined;
  if (invoked?.error) {
    let code = 'unavailable';
    try {
      const payload: unknown = await invoked.error.context?.json();
      const parsed = z.object({ error: z.string() }).safeParse(payload);
      if (parsed.success) code = parsed.data.error;
    } catch {
      // Keep the generic code.
    }
    return { errorCode: code };
  }
  return {
    data:
      invoked?.data && typeof invoked.data === 'object'
        ? (invoked.data as Record<string, unknown>)
        : {},
  };
}

const quoteSchema = z.object({
  jobId: z.uuid(),
  notes: z.string().trim().min(10).max(4000),
});

export async function draftQuoteWithAiAction(
  _previous: AiAssistState,
  formData: FormData,
): Promise<AiAssistState> {
  await requireTenantContext(['owner', 'office']);
  const parsed = quoteSchema.safeParse({
    jobId: formData.get('jobId'),
    notes: formData.get('notes'),
  });
  if (!parsed.success) {
    return {
      message: 'Describe the customer request in at least 10 characters.',
      status: 'error',
    };
  }

  const { data, errorCode } = await invoke('quote-assistant', parsed.data);
  const draftId = z.uuid().safeParse(data?.draftId);
  if (errorCode || !draftId.success) {
    return {
      message:
        errorMessages[errorCode ?? ''] ??
        'The AI draft could not be created. Please try again.',
      status: 'error',
    };
  }
  redirect(`/app/jobs/${parsed.data.jobId}/quote?aiDraft=${draftId.data}`);
}

const translateSchema = z.object({
  jobId: z.uuid(),
  noteId: z.uuid(),
  targetLanguage: z.enum(['en', 'es']),
});

export async function translateNoteAction(
  _previous: AiAssistState,
  formData: FormData,
): Promise<AiAssistState> {
  await requireTenantContext(['owner', 'office']);
  const parsed = translateSchema.safeParse({
    jobId: formData.get('jobId'),
    noteId: formData.get('noteId'),
    targetLanguage: formData.get('targetLanguage'),
  });
  if (!parsed.success) {
    return { message: 'This note could not be translated.', status: 'error' };
  }

  const { errorCode } = await invoke('note-translation', {
    noteId: parsed.data.noteId,
    targetLanguage: parsed.data.targetLanguage,
  });
  if (errorCode) {
    return {
      message:
        errorMessages[errorCode] ??
        'The note could not be translated right now.',
      status: 'error',
    };
  }
  revalidatePath(`/app/jobs/${parsed.data.jobId}`);
  return { message: 'Translated.', status: 'success' };
}
