'use client';

import { useActionState } from 'react';

import type { Tables } from '@crewflow/database';

import {
  addTimeOffAction,
  cancelTimeOffAction,
  type TimeOffState,
} from './time-off-actions';

type TimeOff = Tables<'staff_time_off'>;

const initialState: TimeOffState = { status: 'idle' };

function formatTimeOff(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

function CancelTimeOffForm({
  membershipId,
  timeOffId,
}: Readonly<{ membershipId: string; timeOffId: string }>) {
  const [state, action, pending] = useActionState(
    cancelTimeOffAction,
    initialState,
  );
  return (
    <form action={action} className="time-off-cancel-form">
      <input name="membershipId" type="hidden" value={membershipId} />
      <input name="timeOffId" type="hidden" value={timeOffId} />
      <button className="danger-button" disabled={pending} type="submit">
        {pending ? 'Cancelling…' : 'Cancel'}
      </button>
      {state.message ? (
        <small className={state.status === 'error' ? 'error' : 'success'}>
          {state.message}
        </small>
      ) : null}
    </form>
  );
}

export function TimeOffPanel({
  canAdd,
  membershipId,
  timeOff,
  timeZone,
}: Readonly<{
  canAdd: boolean;
  membershipId: string;
  timeOff: readonly TimeOff[];
  timeZone: string;
}>) {
  const [state, action, pending] = useActionState(
    addTimeOffAction,
    initialState,
  );

  return (
    <section className="team-panel time-off-panel">
      <div className="team-panel-heading">
        <div>
          <h2>Time off</h2>
          <p>Blocked periods are enforced automatically during dispatch.</p>
        </div>
      </div>

      {canAdd ? (
        <form action={action} className="time-off-form">
          <input name="membershipId" type="hidden" value={membershipId} />
          <label>
            <span>Starts *</span>
            <input name="startsLocal" required type="datetime-local" />
            {state.fieldErrors?.startsLocal?.[0] ? (
              <small className="error">
                {state.fieldErrors.startsLocal[0]}
              </small>
            ) : null}
          </label>
          <label>
            <span>Ends *</span>
            <input name="endsLocal" required type="datetime-local" />
            {state.fieldErrors?.endsLocal?.[0] ? (
              <small className="error">{state.fieldErrors.endsLocal[0]}</small>
            ) : null}
          </label>
          <label>
            <span>Reason</span>
            <input maxLength={500} name="reason" placeholder="Vacation" />
          </label>
          <button className="primary-button" disabled={pending} type="submit">
            {pending ? 'Adding…' : 'Add time off'}
          </button>
          {state.message ? (
            <p
              className={`form-status form-status-${state.status}`}
              role="status"
            >
              {state.message}
            </p>
          ) : null}
        </form>
      ) : null}

      {timeOff.length === 0 ? (
        <p className="time-off-empty">No recent or upcoming time off.</p>
      ) : (
        <ul className="time-off-list">
          {timeOff.map((entry) => (
            <li key={entry.id}>
              <div>
                <strong>{entry.reason || 'Time off'}</strong>
                <span>
                  {formatTimeOff(entry.starts_at, timeZone)} –{' '}
                  {formatTimeOff(entry.ends_at, timeZone)}
                </span>
                {entry.cancelled_at ? <small>Cancelled</small> : null}
              </div>
              {!entry.cancelled_at && canAdd ? (
                <CancelTimeOffForm
                  membershipId={membershipId}
                  timeOffId={entry.id}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
