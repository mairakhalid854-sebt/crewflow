'use client';

import { useActionState } from 'react';

import {
  type ApprovalDecisionState,
  retryReportInvoiceExecutionAction,
} from './actions';
import styles from './ai.module.css';

const initialState: ApprovalDecisionState = { status: 'idle' };

export function ReportInvoiceExecutionForm({
  approvalId,
}: {
  approvalId: string;
}) {
  const [state, action, pending] = useActionState(
    retryReportInvoiceExecutionAction,
    initialState,
  );

  return (
    <form action={action} className={styles.executionForm}>
      <input name="approvalId" type="hidden" value={approvalId} />
      <button disabled={pending} type="submit">
        {pending ? 'Revalidating...' : 'Retry guarded invoice save'}
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
