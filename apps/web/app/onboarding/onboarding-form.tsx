'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

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
            <input name="phone" placeholder="(555) 555-0123" type="tel" />
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
          <label>
            City
            <input name="city" required />
          </label>
          <label>
            State
            <input maxLength={2} name="stateCode" placeholder="CA" required />
          </label>
          <label>
            ZIP code
            <input
              inputMode="numeric"
              name="postalCode"
              placeholder="94105"
              required
            />
          </label>
          <label>
            Time zone
            <select defaultValue="America/Los_Angeles" name="timeZone">
              <option value="America/New_York">Eastern</option>
              <option value="America/Chicago">Central</option>
              <option value="America/Denver">Mountain</option>
              <option value="America/Phoenix">Arizona</option>
              <option value="America/Los_Angeles">Pacific</option>
              <option value="America/Anchorage">Alaska</option>
              <option value="Pacific/Honolulu">Hawaii</option>
            </select>
          </label>
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
