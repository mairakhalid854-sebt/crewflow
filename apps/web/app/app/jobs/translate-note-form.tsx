'use client';

import { useActionState } from 'react';

import { type AiAssistState, translateNoteAction } from './ai-assist-actions';

const initialState: AiAssistState = { status: 'idle' };

export function TranslateNoteForm({
  hasTranslation,
  jobId,
  noteId,
}: Readonly<{ hasTranslation: boolean; jobId: string; noteId: string }>) {
  const [state, action, pending] = useActionState(
    translateNoteAction,
    initialState,
  );
  return (
    <form action={action} className="translate-note-form">
      <input name="jobId" type="hidden" value={jobId} />
      <input name="noteId" type="hidden" value={noteId} />
      <input name="targetLanguage" type="hidden" value="en" />
      <button className="link-button" disabled={pending} type="submit">
        {pending
          ? 'Translating…'
          : hasTranslation
            ? 'Translate again'
            : 'Translate to English (AI)'}
      </button>
      {state.status === 'error' ? (
        <span className="translate-note-error" role="alert">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
