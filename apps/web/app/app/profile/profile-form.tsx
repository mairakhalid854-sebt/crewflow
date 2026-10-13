'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import {
  type PersonalProfileActionState,
  updatePersonalProfileAction,
} from './actions';

const initialState: PersonalProfileActionState = { status: 'idle' };

export function PersonalProfileForm({
  email,
  fullName,
  roleLabel,
}: Readonly<{
  email: string;
  fullName: string;
  roleLabel: string;
}>) {
  const [state, action, pending] = useActionState(
    updatePersonalProfileAction,
    initialState,
  );

  return (
    <div className="profile-settings-grid">
      <form action={action} className="resource-form profile-form">
        <div className="settings-section-heading">
          <h2>Personal details</h2>
          <p>Your name is shown in CrewFlow and the team directory.</p>
        </div>
        <div className="form-grid">
          <label className="form-span-2">
            <span>Full name *</span>
            <input
              aria-describedby="fullName-error"
              defaultValue={fullName}
              maxLength={120}
              name="fullName"
              required
            />
            {state.fieldErrors?.fullName?.length ? (
              <p className="field-error" id="fullName-error" role="alert">
                {state.fieldErrors.fullName[0]}
              </p>
            ) : null}
          </label>
          <label>
            <span>Login email</span>
            <input disabled type="email" value={email} />
          </label>
          <label>
            <span>Workspace role</span>
            <input disabled value={roleLabel} />
          </label>
        </div>

        {state.message ? (
          <p
            className={`form-status form-status-${state.status}`}
            role={state.status === 'error' ? 'alert' : 'status'}
          >
            {state.message}
          </p>
        ) : null}

        <button className="primary-button" disabled={pending} type="submit">
          {pending ? 'Saving...' : 'Save profile'}
        </button>
      </form>

      <aside className="profile-security-card">
        <p className="workspace-kicker">Account security</p>
        <h2>Password</h2>
        <p>
          Password changes use a secure email link so your current password is
          never displayed.
        </p>
        <Link className="secondary-button" href="/forgot-password">
          Request password reset
        </Link>
      </aside>
    </div>
  );
}
