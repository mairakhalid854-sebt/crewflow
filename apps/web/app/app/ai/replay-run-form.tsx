'use client';

import { useActionState } from 'react';

import { type ApprovalDecisionState, replayAiRunAction } from './actions';
import styles from './ai.module.css';

const initialState: ApprovalDecisionState = { status: 'idle' };

export function ReplayRunForm({ runId }: { runId: string }) {
  const [state, action, pending] = useActionState(
    replayAiRunAction,
    initialState,
  );

  return (
    <form action={action} className={styles.replayForm}>
      <input name="runId" type="hidden" value={runId} />
      <div>
        <strong>Re-evaluate with current controls</strong>
        <p>
          Creates a fresh proposal and approval. It never reuses this decision
          or executes the proposed change.
        </p>
      </div>
      <button disabled={pending} type="submit">
        {pending ? 'Re-evaluating...' : 'Replay current policy'}
      </button>
      {state.message ? (
        <p
          className={state.status === 'error' ? styles.error : styles.success}
          role="status"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
