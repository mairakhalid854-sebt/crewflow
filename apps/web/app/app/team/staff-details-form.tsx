'use client';

import { useActionState } from 'react';

import type { Tables } from '@crewflow/database';

import { type TeamActionState, updateStaffDetailsAction } from './actions';

type StaffProfile = Tables<'staff_profiles'>;
type StaffAvailability = Tables<'staff_availability'>;

const initialState: TeamActionState = { status: 'idle' };
const days = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

function timeValue(value: string | null): string {
  return value?.slice(0, 5) ?? '09:00';
}

export function StaffDetailsForm({
  availability,
  profile,
}: Readonly<{
  availability: readonly StaffAvailability[];
  profile: StaffProfile;
}>) {
  const [state, action, pending] = useActionState(
    updateStaffDetailsAction,
    initialState,
  );
  const schedule = new Map(
    availability.map((day) => [day.day_of_week, day] as const),
  );

  return (
    <form action={action} className="resource-form staff-details-form">
      <input name="membershipId" type="hidden" value={profile.membership_id} />
      <div className="form-grid">
        <label className="form-span-2">
          <span>Display name *</span>
          <input
            defaultValue={profile.full_name}
            maxLength={120}
            name="fullName"
            required
          />
        </label>
        <label className="form-span-2">
          <span>Skills</span>
          <input
            defaultValue={profile.skills.join(', ')}
            name="skills"
            placeholder="HVAC repair, Installation, Diagnostics"
          />
          <small>Separate up to 30 skills with commas.</small>
        </label>
        <label className="form-span-2">
          <span>Service-area ZIP codes</span>
          <input
            defaultValue={profile.service_area_postal_codes.join(', ')}
            name="postalCodes"
            placeholder="94105, 94107, 94110"
          />
          <small>Separate US ZIP codes with commas.</small>
        </label>
      </div>

      <fieldset className="availability-fieldset">
        <legend>Weekly availability</legend>
        {days.map((dayName, dayOfWeek) => {
          const day = schedule.get(dayOfWeek);
          return (
            <div className="availability-row" key={dayName}>
              <label>
                <input
                  defaultChecked={day?.is_available ?? false}
                  name={`available-${dayOfWeek}`}
                  type="checkbox"
                />
                {dayName}
              </label>
              <label>
                <span className="sr-only">{dayName} start time</span>
                <input
                  defaultValue={timeValue(day?.starts_at ?? null)}
                  name={`starts-${dayOfWeek}`}
                  type="time"
                />
              </label>
              <span>to</span>
              <label>
                <span className="sr-only">{dayName} end time</span>
                <input
                  defaultValue={day?.ends_at ? timeValue(day.ends_at) : '17:00'}
                  name={`ends-${dayOfWeek}`}
                  type="time"
                />
              </label>
            </div>
          );
        })}
      </fieldset>

      <label className="staff-notes-field">
        <span>Availability notes</span>
        <textarea
          defaultValue={profile.availability_notes ?? ''}
          maxLength={1000}
          name="availabilityNotes"
          placeholder="On-call constraints, preferred hours, or coverage notes"
          rows={4}
        />
      </label>

      {state.message ? (
        <p
          className={`form-status form-status-${state.status}`}
          role={state.status === 'error' ? 'alert' : 'status'}
        >
          {state.message}
        </p>
      ) : null}

      <button className="primary-button" disabled={pending} type="submit">
        {pending ? 'Saving…' : 'Save staff details'}
      </button>
    </form>
  );
}
