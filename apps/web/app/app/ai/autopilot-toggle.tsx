'use client';

import { useActionState } from 'react';

import {
  type ApprovalDecisionState,
  setAutopilotPolicyAction,
} from './actions';
import styles from './ai.module.css';

const initialState: ApprovalDecisionState = { status: 'idle' };

interface AutopilotToggleProps {
  readonly canEdit: boolean;
  readonly enabled: boolean;
  readonly label: string;
  readonly policyKey: string;
}

export function AutopilotToggle({
  canEdit,
  enabled,
  label,
  policyKey,
}: AutopilotToggleProps) {
  const [state, action, pending] = useActionState(
    setAutopilotPolicyAction,
    initialState,
  );

  return (
    <form action={action} className={styles.autopilotToggleForm}>
      <input name="policyKey" type="hidden" value={policyKey} />
      <input name="enabled" type="hidden" value={enabled ? 'false' : 'true'} />
      <button
        aria-label={`${label}: Autopilot ${enabled ? 'on' : 'off'}`}
        aria-pressed={enabled}
        className={styles.autopilotSwitch}
        data-on={enabled}
        disabled={!canEdit || pending}
        type="submit"
      >
        <span aria-hidden="true" className={styles.autopilotKnob} />
        <span>{pending ? 'Saving…' : enabled ? 'On' : 'Off'}</span>
      </button>
      {state.status === 'error' ? (
        <p className={styles.autopilotError} role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
