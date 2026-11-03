'use client';

import { usStateName } from '../lib/location/us-locations';
import {
  type UsTimeZone,
  stateHasMultipleTimeZones,
} from '../lib/location/us-time-zones';

const TIME_ZONE_LABELS: Readonly<Record<UsTimeZone, string>> = {
  'America/Anchorage': 'Alaska',
  'America/Chicago': 'Central',
  'America/Denver': 'Mountain',
  'America/Los_Angeles': 'Pacific',
  'America/New_York': 'Eastern',
  'America/Phoenix': 'Arizona',
  'Pacific/Honolulu': 'Hawaii',
};

const TIME_ZONE_ORDER: readonly UsTimeZone[] = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
];

export function UsTimeZoneSelect({
  errors,
  onChange,
  required = false,
  stateCode,
  value,
}: Readonly<{
  errors?: readonly string[];
  onChange: (value: string) => void;
  required?: boolean;
  stateCode: string;
  value: string;
}>) {
  const stateName = stateCode ? usStateName(stateCode) : undefined;
  const showMultiZoneHint =
    Boolean(stateName) && stateHasMultipleTimeZones(stateCode);

  return (
    <label>
      <span>Time zone{required ? ' *' : ''}</span>
      <select
        aria-describedby="timeZone-hint timeZone-error"
        name="timeZone"
        onChange={(event) => onChange(event.target.value)}
        required={required}
        value={value}
      >
        <option value="">Select a time zone</option>
        {TIME_ZONE_ORDER.map((timeZone) => (
          <option key={timeZone} value={timeZone}>
            {TIME_ZONE_LABELS[timeZone]}
          </option>
        ))}
      </select>
      {showMultiZoneHint ? (
        <p className="field-help" id="timeZone-hint">
          Parts of {stateName} use a different time zone. Confirm this matches
          your service area.
        </p>
      ) : null}
      {errors?.length ? (
        <p className="field-error" id="timeZone-error" role="alert">
          {errors[0]}
        </p>
      ) : null}
    </label>
  );
}
