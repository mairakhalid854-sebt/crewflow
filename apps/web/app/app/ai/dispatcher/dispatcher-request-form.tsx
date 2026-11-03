'use client';

import { useActionState } from 'react';

import styles from '../ai.module.css';
import {
  type DispatcherRequestState,
  requestDispatcherProposalAction,
} from './actions';

const initialState: DispatcherRequestState = { status: 'idle' };

export function DispatcherRequestForm({
  disabledReason,
  jobId,
}: {
  disabledReason?: string;
  jobId: string;
}) {
  const [state, action, pending] = useActionState(
    requestDispatcherProposalAction,
    initialState,
  );

  return (
    <form action={action} className={styles.dispatcherForm}>
      <input name="jobId" type="hidden" value={jobId} />
      <button
        aria-busy={pending}
        disabled={Boolean(disabledReason) || pending}
        title={disabledReason}
        type="submit"
      >
        {pending ? 'Evaluating…' : (disabledReason ?? 'Suggest technician')}
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
