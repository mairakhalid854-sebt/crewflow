'use client';

import { useActionState, useState } from 'react';

import {
  type ReferralActionState,
  type ReferralLinkState,
  decideReferralAction,
  referralLinkAction,
  saveReferralProgramAction,
} from './actions';

function FieldError({
  errors,
  id,
}: Readonly<{ errors?: readonly string[]; id: string }>) {
  if (!errors?.length) return null;
  return (
    <p className="field-error" id={id} role="alert">
      {errors[0]}
    </p>
  );
}

export function ReferralProgramForm({
  program,
}: Readonly<{
  program: {
    enabled: boolean;
    friend_reward_cents: number;
    referrer_reward_cents: number;
    reward_note: string | null;
  } | null;
}>) {
  const [state, action, pending] = useActionState<
    ReferralActionState,
    FormData
  >(saveReferralProgramAction, { status: 'idle' });

  return (
    <form action={action}>
      <section className="settings-section" aria-labelledby="referral-rewards">
        <div className="settings-section-heading">
          <h2 id="referral-rewards">Rewards</h2>
          <p>
            Both people get a reward after the friend&apos;s job is completed.
            You give the reward yourself, for example as a discount on the next
            invoice, then mark it as rewarded here.
          </p>
        </div>
        <div className="form-grid">
          <label>
            <span>Reward for the customer who refers (USD)</span>
            <input
              aria-describedby="referrer-error"
              defaultValue={(
                (program?.referrer_reward_cents ?? 2500) / 100
              ).toFixed(2)}
              inputMode="decimal"
              min="0"
              name="referrerReward"
              step="0.01"
              type="number"
            />
            <FieldError
              errors={state.fieldErrors?.referrerReward}
              id="referrer-error"
            />
          </label>
          <label>
            <span>Reward for the new friend (USD)</span>
            <input
              aria-describedby="friend-error"
              defaultValue={(
                (program?.friend_reward_cents ?? 2500) / 100
              ).toFixed(2)}
              inputMode="decimal"
              min="0"
              name="friendReward"
              step="0.01"
              type="number"
            />
            <FieldError
              errors={state.fieldErrors?.friendReward}
              id="friend-error"
            />
          </label>
          <label className="referral-wide">
            <span>How the reward is given (shown to customers)</span>
            <input
              defaultValue={program?.reward_note ?? ''}
              maxLength={240}
              name="rewardNote"
              placeholder="Credit on your next visit. One reward per new customer."
            />
            <FieldError
              errors={state.fieldErrors?.rewardNote}
              id="note-error"
            />
          </label>
        </div>
        <label className="checkbox-field referral-enable">
          <input
            defaultChecked={program?.enabled ?? false}
            name="enabled"
            type="checkbox"
          />
          <span>
            <strong>Referral program is on.</strong> Customer referral links
            work on your booking page.
          </span>
        </label>
      </section>

      {state.message ? (
        <p
          className={
            state.status === 'error' ? 'form-message-error' : 'form-message'
          }
          role={state.status === 'error' ? 'alert' : 'status'}
        >
          {state.message}
        </p>
      ) : null}

      <div className="settings-save-bar">
        <p>Changes are recorded in the audit trail.</p>
        <button className="primary-button" disabled={pending} type="submit">
          {pending ? 'Saving...' : 'Save referral program'}
        </button>
      </div>
    </form>
  );
}

export function ReferralDecision({
  canReward,
  referralId,
}: Readonly<{ canReward: boolean; referralId: string }>) {
  const [state, action, pending] = useActionState<
    ReferralActionState,
    FormData
  >(decideReferralAction, { status: 'idle' });

  if (state.status === 'success') {
    return (
      <p className="form-message" role="status">
        {state.message}
      </p>
    );
  }

  return (
    <form action={action} className="referral-decision">
      <input name="referralId" type="hidden" value={referralId} />
      {canReward ? (
        <button
          className="primary-button"
          disabled={pending}
          name="decision"
          type="submit"
          value="reward"
        >
          Mark rewards given
        </button>
      ) : null}
      <button
        className="secondary-button"
        disabled={pending}
        name="decision"
        type="submit"
        value="void"
      >
        Not eligible
      </button>
      {state.status === 'error' ? (
        <p className="field-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function ReferralLinkCard({
  customerId,
}: Readonly<{ customerId: string }>) {
  const [state, action, pending] = useActionState<ReferralLinkState, FormData>(
    referralLinkAction,
    { status: 'idle' },
  );
  const [copied, setCopied] = useState(false);

  return (
    <section className="team-panel referral-link-card">
      <div className="team-panel-heading">
        <div>
          <h2>Referral link</h2>
          <p>
            Send this link to the customer by text or email. Friends who book
            through it are tracked under Referrals.
          </p>
        </div>
      </div>
      {state.link ? (
        <div className="referral-link-row">
          <code>{state.link}</code>
          <button
            className="secondary-button"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(state.link ?? '')
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
            type="button"
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      ) : (
        <form action={action}>
          <input name="customerId" type="hidden" value={customerId} />
          <button className="secondary-button" disabled={pending} type="submit">
            {pending ? 'Creating…' : 'Get referral link'}
          </button>
        </form>
      )}
      {state.status === 'error' ? (
        <p className="field-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
