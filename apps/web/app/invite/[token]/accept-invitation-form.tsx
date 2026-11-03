'use client';

import { useActionState } from 'react';

import { type AcceptInvitationState, acceptInvitationAction } from './actions';

const initialState: AcceptInvitationState = { status: 'idle' };

export function AcceptInvitationForm({ token }: Readonly<{ token: string }>) {
  const [state, action, pending] = useActionState(
    acceptInvitationAction,
    initialState,
  );

  return (
    <form action={action}>
      <input name="token" type="hidden" value={token} />
      {state.message ? (
        <p className="invite-error" role="alert">
          {state.message}
        </p>
      ) : null}
      <button disabled={pending} type="submit">
        {pending ? 'Joining workspace…' : 'Accept invitation'}
      </button>
    </form>
  );
}
