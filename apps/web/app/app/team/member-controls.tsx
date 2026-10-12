'use client';

import { useActionState } from 'react';

import type { Database } from '@crewflow/database';

import {
  deactivateMemberAction,
  type TeamActionState,
  updateMemberRoleAction,
} from './actions';

type MembershipRole = Database['public']['Enums']['membership_role'];
const initialState: TeamActionState = { status: 'idle' };

export function MemberControls({
  canDeactivate,
  membershipId,
  role,
}: Readonly<{
  canDeactivate: boolean;
  membershipId: string;
  role: MembershipRole;
}>) {
  const [roleState, roleAction, rolePending] = useActionState(
    updateMemberRoleAction,
    initialState,
  );
  const [deactivateState, deactivateAction, deactivatePending] = useActionState(
    deactivateMemberAction,
    initialState,
  );

  return (
    <div className="member-controls">
      <form action={roleAction}>
        <input name="membershipId" type="hidden" value={membershipId} />
        <label className="sr-only" htmlFor={`role-${membershipId}`}>
          Team member role
        </label>
        <select defaultValue={role} id={`role-${membershipId}`} name="role">
          <option value="owner">Owner</option>
          <option value="office">Office staff</option>
          <option value="technician">Technician</option>
        </select>
        <button
          className="secondary-button"
          disabled={rolePending}
          type="submit"
        >
          {rolePending ? 'Saving…' : 'Save role'}
        </button>
      </form>
      {roleState.message ? (
        <small className={roleState.status}>{roleState.message}</small>
      ) : null}

      {canDeactivate ? (
        <form
          action={deactivateAction}
          onSubmit={(event) => {
            if (
              !window.confirm(
                'Deactivate this team member now? Their CrewFlow access will stop immediately.',
              )
            ) {
              event.preventDefault();
            }
          }}
        >
          <input name="membershipId" type="hidden" value={membershipId} />
          <button
            className="danger-button"
            disabled={deactivatePending}
            type="submit"
          >
            {deactivatePending ? 'Deactivating…' : 'Deactivate access'}
          </button>
        </form>
      ) : null}
      {deactivateState.message ? (
        <small className={deactivateState.status}>
          {deactivateState.message}
        </small>
      ) : null}
    </div>
  );
}
