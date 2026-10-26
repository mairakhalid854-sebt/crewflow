'use client';

import { useActionState } from 'react';

import {
  type ProviderEvaluationState,
  runProviderEvaluationAction,
} from './provider-evaluation-actions';
import styles from './ai.module.css';

const initialState: ProviderEvaluationState = { status: 'idle' };

export function ProviderEvaluationForm() {
  const [state, action, pending] = useActionState(
    runProviderEvaluationAction,
    initialState,
  );

  return (
    <form action={action} className={styles.evaluationPanel}>
      <div>
        <p className={styles.kicker}>Staging activation gate</p>
        <h2>OpenAI provider evaluation</h2>
        <p>
          Runs eight synthetic, tool-free cases across all four agents. Maximum
          recorded evaluation budget is $0.16; no customer data is sent or
          retained.
        </p>
      </div>
      <button disabled={pending} type="submit">
        {pending ? 'Evaluating safely...' : 'Run provider evaluation'}
      </button>
      {state.message ? (
        <div
          className={state.status === 'error' ? styles.error : styles.success}
          role="status"
        >
          <strong>{state.message}</strong>
          {state.report ? (
            <p>
              {state.report.casesPassed}/{state.report.casesRun} cases passed
              {' · '}P95 {state.report.p95DurationMilliseconds} ms{' · '}
              Estimated cost $
              {(state.report.totalEstimatedCostCents / 100).toFixed(2)} {' · '}
              {state.report.modelId}
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
