'use client';

import { useActionState } from 'react';

import {
  type AiAssistState,
  draftQuoteWithAiAction,
} from './ai-assist-actions';

const initialState: AiAssistState = { status: 'idle' };

export function QuoteAssistantForm({ jobId }: Readonly<{ jobId: string }>) {
  const [state, action, pending] = useActionState(
    draftQuoteWithAiAction,
    initialState,
  );
  return (
    <form action={action} className="quote-assistant-form">
      <input name="jobId" type="hidden" value={jobId} />
      <label>
        <span>What does the customer need?</span>
        <textarea
          maxLength={4000}
          minLength={10}
          name="notes"
          placeholder="e.g. AC not cooling upstairs, 2-story house, unit about 12 years old, wants it checked this week."
          required
          rows={4}
        />
      </label>
      <button className="secondary-button" disabled={pending} type="submit">
        {pending ? 'Drafting…' : 'Draft quote lines with AI'}
      </button>
      {state.status === 'error' ? (
        <p className="quote-assistant-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
