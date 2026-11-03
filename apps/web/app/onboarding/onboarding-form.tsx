'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { UsLocationFields } from '../../components/us-location-fields';
import { UsTimeZoneSelect } from '../../components/us-time-zone-select';
import { defaultTimeZoneForState } from '../../lib/location/us-time-zones';

import { type OnboardingFormState, completeOnboardingAction } from './actions';

const initialOnboardingState: OnboardingFormState = { status: 'idle' };

const serviceCategories = [
  'HVAC',
  'Plumbing',
  'Electrical',
  'Cleaning',
  'Pest control',
  'Other',
];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="onboarding-submit" disabled={pending} type="submit">
      {pending ? 'Creating workspace...' : 'Create workspace'}
    </button>
  );
}

export function OnboardingForm() {
  const [state, action] = useActionState(
    completeOnboardingAction,
    initialOnboardingState,
  );
  const [stateCode, setStateCode] = useState('');
  const [timeZone, setTimeZone] = useState('');

  return (
    <form action={action} className="onboarding-form">
      <fieldset>
        <legend>Business identity</legend>
        <div className="form-grid">
          <label>
            Legal business name
            <input name="legalName" required />
          </label>
          <label>
            Display name
            <input name="displayName" required />
          </label>
          <label>
            Business email
            <input name="businessEmail" required type="email" />
          </label>
          <label>
            US phone
            <input
              autoComplete="tel-national"
              inputMode="tel"
              maxLength={20}
              name="phone"
              placeholder="(555) 555-0123"
              type="tel"
            />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Service address</legend>
        <div className="form-grid">
          <label className="span-two">
            Street address
            <input name="streetAddress" required />
          </label>
          <UsLocationFields
            cityErrorId="city-error"
            cityErrors={state.fieldErrors?.city}
            onStateChange={(nextStateCode) => {
              setStateCode(nextStateCode);
              const suggested = defaultTimeZoneForState(nextStateCode);
              if (suggested) setTimeZone(suggested);
            }}
            required
            stateErrorId="state-code-error"
            stateErrors={state.fieldErrors?.stateCode}
          />
          <label>
            ZIP code
            <input
              inputMode="numeric"
              name="postalCode"
              placeholder="94105"
              required
            />
          </label>
          <UsTimeZoneSelect
            onChange={setTimeZone}
            required
            stateCode={stateCode}
            value={timeZone}
          />
        </div>
      </fieldset>

      <fieldset>
        <legend>Services and tax</legend>
        <p className="fieldset-help">
          Choose every category your company currently offers.
        </p>
        <div className="category-grid">
          {serviceCategories.map((category) => (
            <label className="check-card" key={category}>
              <input
                name="serviceCategories"
                type="checkbox"
                value={category}
              />
              <span>{category}</span>
            </label>
          ))}
        </div>
        <label className="tax-field">
          Default tax rate (%)
          <input
            defaultValue="0"
            max="100"
            min="0"
            name="taxRatePercent"
            step="0.01"
            type="number"
          />
        </label>
      </fieldset>

      {state.fieldErrors ? (
        <div className="onboarding-errors" role="alert">
          {Object.values(state.fieldErrors)
            .flat()
            .map((error) => (
              <p key={error}>{error}</p>
            ))}
        </div>
      ) : null}
      {state.message ? (
        <p className="onboarding-errors" role="alert">
          {state.message}
        </p>
      ) : null}
      <div className="onboarding-actions">
        <p>USD is the only supported currency in v1.</p>
        <SubmitButton />
      </div>
    </form>
  );
}
