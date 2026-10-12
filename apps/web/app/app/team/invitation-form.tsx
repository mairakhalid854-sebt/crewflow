'use client';

import { useActionState, useState } from 'react';

import { createInvitationAction, type TeamActionState } from './actions';

const initialState: TeamActionState = { status: 'idle' };

export function InvitationForm() {
  const [state, action, pending] = useActionState(
    createInvitationAction,
    initialState,
  );
  const [copied, setCopied] = useState(false);

  return (
    <form action={action} className="invite-team-form">
      <div>
        <label htmlFor="invite-email">Team member email</label>
        <input
          aria-describedby="invite-email-error"
          id="invite-email"
          name="email"
          placeholder="name@company.com"
          required
          type="email"
        />
        {state.fieldErrors?.email?.[0] ? (
          <p className="field-error" id="invite-email-error" role="alert">
            {state.fieldErrors.email[0]}
          </p>
        ) : null}
      </div>
      <div>
        <label htmlFor="invite-role">Role</label>
        <select defaultValue="technician" id="invite-role" name="role">
          <option value="technician">Technician</option>
          <option value="office">Office staff</option>
          <option value="owner">Owner</option>
        </select>
      </div>
      <button className="primary-button" disabled={pending} type="submit">
        {pending ? 'Creating link…' : 'Create invitation link'}
      </button>

      {state.message ? (
        <p
          className={`form-status form-status-${state.status}`}
          role={state.status === 'error' ? 'alert' : 'status'}
        >
          {state.message}
        </p>
      ) : null}

      {state.inviteUrl ? (
        <div className="invite-link-result">
          <label htmlFor="invite-link">Secure link (shown once)</label>
          <div>
            <input id="invite-link" readOnly value={state.inviteUrl} />
            <button
              className="secondary-button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(state.inviteUrl ?? '')
                  .then(() => setCopied(true));
              }}
              type="button"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <small>
            Expires{' '}
            {state.expiresAt
              ? new Intl.DateTimeFormat(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(state.expiresAt))
              : 'in 72 hours'}
            . Send it privately to the invited email address.
          </small>
        </div>
      ) : null}
    </form>
  );
}
