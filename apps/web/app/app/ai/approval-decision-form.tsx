'use client';

import { useActionState } from 'react';

import { type ApprovalDecisionState, decideApprovalAction } from './actions';
import styles from './ai.module.css';

const initialState: ApprovalDecisionState = { status: 'idle' };

export function ApprovalDecisionForm({ approvalId }: { approvalId: string }) {
  const [state, action, pending] = useActionState(
    decideApprovalAction,
    initialState,
  );

  return (
    <form action={action} className={styles.decisionForm}>
      <input name="approvalId" type="hidden" value={approvalId} />
      <label>
        Decision reason
        <textarea
          maxLength={500}
          minLength={3}
          name="reason"
          placeholder="Why is this safe to approve, or why should it be rejected?"
          required
          rows={3}
        />
      </label>
      <label className={styles.confirmation}>
        <input name="acknowledged" required type="checkbox" />
        <span>
          I reviewed the exact changes and consequences shown above. Approval
          authorizes only the described action and does not bypass final policy
          checks.
        </span>
      </label>
      <div className={styles.actions}>
        <button
          className={styles.approveButton}
          disabled={pending}
          name="decision"
          type="submit"
          value="approved"
        >
          {pending ? 'Recording…' : 'Approve'}
        </button>
        <button
          className={styles.rejectButton}
          disabled={pending}
          name="decision"
          type="submit"
          value="rejected"
        >
          {pending ? 'Recording…' : 'Reject'}
        </button>
      </div>
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
