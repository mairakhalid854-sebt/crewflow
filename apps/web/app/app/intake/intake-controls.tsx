'use client';

import { useActionState, useState } from 'react';

import {
  type IntakeActionState,
  setIntakeWidgetEnabledAction,
  takeOverIntakeConversationAction,
} from './actions';
import styles from './intake.module.css';

const initialState: IntakeActionState = { status: 'idle' };

export function WidgetControls({
  enabled,
  shareUrl,
}: {
  enabled: boolean;
  shareUrl: string;
}) {
  const [state, action, pending] = useActionState(
    setIntakeWidgetEnabledAction,
    initialState,
  );
  const [copied, setCopied] = useState(false);

  return (
    <section className={styles.widgetCard}>
      <div>
        <p className={styles.kicker}>Public request link</p>
        <h2>
          {enabled ? 'Intake is accepting requests' : 'Intake is disabled'}
        </h2>
        <p>
          Enable this only when your service catalog is ready. Every completed
          request still requires office review.
        </p>
      </div>
      <div className={styles.linkRow}>
        <input aria-label="Public Intake link" readOnly value={shareUrl} />
        <button
          className={styles.secondaryButton}
          onClick={() => {
            void navigator.clipboard.writeText(shareUrl).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1800);
            });
          }}
          type="button"
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
      <form action={action}>
        <input
          name="enabled"
          type="hidden"
          value={enabled ? 'false' : 'true'}
        />
        <button
          className={enabled ? styles.dangerButton : styles.primaryButton}
          disabled={pending}
          type="submit"
        >
          {pending
            ? 'Saving…'
            : enabled
              ? 'Disable public Intake'
              : 'Enable public Intake'}
        </button>
      </form>
      {state.message ? (
        <p
          className={state.status === 'error' ? styles.error : styles.success}
          role="status"
        >
          {state.message}
        </p>
      ) : null}
    </section>
  );
}

export function TakeoverButton({ conversationId }: { conversationId: string }) {
  const [state, action, pending] = useActionState(
    takeOverIntakeConversationAction,
    initialState,
  );

  return (
    <form action={action} className={styles.takeoverForm}>
      <input name="conversationId" type="hidden" value={conversationId} />
      <button disabled={pending} type="submit">
        {pending ? 'Joining…' : 'Take over'}
      </button>
      {state.message ? (
        <span
          className={state.status === 'error' ? styles.error : styles.success}
        >
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
