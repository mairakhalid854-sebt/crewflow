'use client';

import { useMemo, useState } from 'react';

import { US_STATES, usCitiesForState } from '../lib/location/us-locations';

interface UsLocationFieldsProps {
  readonly cityErrorId?: string;
  readonly cityErrors?: readonly string[];
  readonly initialCity?: string | null;
  readonly initialStateCode?: string | null;
  readonly required?: boolean;
  readonly stateErrorId?: string;
  readonly stateErrors?: readonly string[];
}

function FieldError({
  errors,
  id,
}: Readonly<{ errors?: readonly string[]; id?: string }>) {
  if (!errors?.length) return null;

  return (
    <p className="field-error" id={id} role="alert">
      {errors[0]}
    </p>
  );
}

export function UsLocationFields({
  cityErrorId,
  cityErrors,
  initialCity = '',
  initialStateCode = '',
  required = false,
  stateErrorId,
  stateErrors,
}: UsLocationFieldsProps) {
  const [stateCode, setStateCode] = useState(initialStateCode ?? '');
  const [city, setCity] = useState(initialCity ?? '');

  const cities = useMemo(() => usCitiesForState(stateCode), [stateCode]);
  const hasLegacyCity = city && !cities.includes(city);

  return (
    <>
      <label>
        <span>Country</span>
        <select aria-label="Country" disabled value="US">
          <option value="US">United States</option>
        </select>
        <input name="countryCode" type="hidden" value="US" />
      </label>
      <label>
        <span>State{required ? ' *' : ''}</span>
        <select
          aria-describedby={stateErrorId}
          name="stateCode"
          onChange={(event) => {
            setStateCode(event.target.value);
            setCity('');
          }}
          required={required}
          value={stateCode}
        >
          <option value="">Select a state</option>
          {US_STATES.map((state) => (
            <option key={state.abbreviation} value={state.abbreviation}>
              {state.name}
            </option>
          ))}
        </select>
        <FieldError errors={stateErrors} id={stateErrorId} />
      </label>
      <label>
        <span>City{required ? ' *' : ''}</span>
        <select
          aria-describedby={cityErrorId}
          disabled={!stateCode}
          name="city"
          onChange={(event) => setCity(event.target.value)}
          required={required}
          value={city}
        >
          <option value="">
            {stateCode ? 'Select a city' : 'Select a state first'}
          </option>
          {hasLegacyCity ? <option value={city}>{city}</option> : null}
          {cities.map((cityName) => (
            <option key={cityName} value={cityName}>
              {cityName}
            </option>
          ))}
        </select>
        <FieldError errors={cityErrors} id={cityErrorId} />
      </label>
    </>
  );
}
