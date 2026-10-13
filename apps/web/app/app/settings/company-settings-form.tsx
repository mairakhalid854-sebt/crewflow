'use client';

import { useActionState, useState } from 'react';

import type { Tables } from '@crewflow/database';

import { UsLocationFields } from '../../../components/us-location-fields';

import {
  type CompanySettingsActionState,
  updateCompanySettingsAction,
} from './actions';

type Tenant = Tables<'tenants'>;
type TenantSettings = Tables<'tenant_settings'>;
type BusinessHours = Tables<'business_hours'>;

const initialState: CompanySettingsActionState = { status: 'idle' };
const serviceCategories = [
  'HVAC',
  'Plumbing',
  'Electrical',
  'Cleaning',
  'Pest control',
  'Other',
] as const;
const days = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

function FieldError({
  errors,
  id,
}: Readonly<{ errors?: readonly string[]; id: string }>) {
  if (!errors?.length) return null;
  return (
    <p className="field-error" id={id} role="alert">
      {errors[0]}
    </p>
  );
}

function timeValue(value: string | null, fallback: string): string {
  return value?.slice(0, 5) ?? fallback;
}

export function CompanySettingsForm({
  businessHours,
  settings,
  tenant,
}: Readonly<{
  businessHours: readonly BusinessHours[];
  settings: TenantSettings;
  tenant: Tenant;
}>) {
  const [state, action, pending] = useActionState(
    updateCompanySettingsAction,
    initialState,
  );
  const schedule = new Map(
    businessHours.map((day) => [day.day_of_week, day] as const),
  );
  const [openDays, setOpenDays] = useState(
    () =>
      new Set(
        businessHours
          .filter((day) => day.is_open)
          .map((day) => day.day_of_week),
      ),
  );

  return (
    <form action={action} className="resource-form settings-form">
      <section className="settings-section" aria-labelledby="business-identity">
        <div className="settings-section-heading">
          <h2 id="business-identity">Business identity</h2>
          <p>Used on customer-facing records and workspace navigation.</p>
        </div>
        <div className="form-grid">
          <label>
            <span>Legal business name *</span>
            <input
              aria-describedby="legalName-error"
              defaultValue={tenant.legal_name}
              maxLength={160}
              name="legalName"
              required
            />
            <FieldError
              errors={state.fieldErrors?.legalName}
              id="legalName-error"
            />
          </label>
          <label>
            <span>Display name *</span>
            <input
              aria-describedby="displayName-error"
              defaultValue={tenant.display_name}
              maxLength={120}
              name="displayName"
              required
            />
            <FieldError
              errors={state.fieldErrors?.displayName}
              id="displayName-error"
            />
          </label>
          <label>
            <span>Business email *</span>
            <input
              aria-describedby="businessEmail-error"
              defaultValue={tenant.business_email}
              name="businessEmail"
              required
              type="email"
            />
            <FieldError
              errors={state.fieldErrors?.businessEmail}
              id="businessEmail-error"
            />
          </label>
          <label>
            <span>US phone</span>
            <input
              defaultValue={tenant.phone ?? ''}
              inputMode="tel"
              maxLength={30}
              name="phone"
              type="tel"
            />
          </label>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="service-address">
        <div className="settings-section-heading">
          <h2 id="service-address">Service address</h2>
          <p>US-only operating address for Phase 1.</p>
        </div>
        <div className="form-grid">
          <label className="form-span-2">
            <span>Street address *</span>
            <input
              aria-describedby="streetAddress-error"
              defaultValue={tenant.street_address ?? ''}
              maxLength={180}
              name="streetAddress"
              required
            />
            <FieldError
              errors={state.fieldErrors?.streetAddress}
              id="streetAddress-error"
            />
          </label>
          <UsLocationFields
            cityErrorId="city-error"
            cityErrors={state.fieldErrors?.city}
            initialCity={tenant.city}
            initialStateCode={tenant.state_code}
            required
            stateErrorId="stateCode-error"
            stateErrors={state.fieldErrors?.stateCode}
          />
          <label>
            <span>ZIP code *</span>
            <input
              aria-describedby="postalCode-error"
              defaultValue={tenant.postal_code ?? ''}
              inputMode="numeric"
              maxLength={10}
              name="postalCode"
              required
            />
            <FieldError
              errors={state.fieldErrors?.postalCode}
              id="postalCode-error"
            />
          </label>
          <label>
            <span>Time zone *</span>
            <select defaultValue={tenant.time_zone} name="timeZone" required>
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
      </section>

      <section className="settings-section" aria-labelledby="services-tax">
        <div className="settings-section-heading">
          <h2 id="services-tax">Services and tax</h2>
          <p>Default operating categories and tax rate for future jobs.</p>
        </div>
        <fieldset className="form-consent settings-category-grid">
          <legend>Service categories *</legend>
          {serviceCategories.map((category) => (
            <label key={category}>
              <input
                defaultChecked={tenant.service_categories.includes(category)}
                name="serviceCategories"
                type="checkbox"
                value={category}
              />
              {category}
            </label>
          ))}
          <FieldError
            errors={state.fieldErrors?.serviceCategories}
            id="serviceCategories-error"
          />
        </fieldset>
        <div className="form-grid">
          <label>
            <span>Default tax rate (%)</span>
            <input
              defaultValue={(tenant.tax_rate_bps / 100).toFixed(2)}
              max="100"
              min="0"
              name="taxRatePercent"
              step="0.01"
              type="number"
            />
          </label>
          <label>
            <span>Currency</span>
            <input disabled value="USD" />
          </label>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="business-hours">
        <div className="settings-section-heading">
          <h2 id="business-hours">Business hours</h2>
          <p>Closed days ignore their time fields.</p>
        </div>
        <fieldset className="availability-fieldset settings-hours">
          <legend>Weekly schedule</legend>
          {days.map((dayName, dayOfWeek) => {
            const day = schedule.get(dayOfWeek);
            const isOpen = openDays.has(dayOfWeek);
            return (
              <div className="availability-row" key={dayName}>
                <label>
                  <input
                    checked={isOpen}
                    name={`open-${dayOfWeek}`}
                    onChange={(event) => {
                      setOpenDays((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(dayOfWeek);
                        else next.delete(dayOfWeek);
                        return next;
                      });
                    }}
                    type="checkbox"
                  />
                  {dayName}
                </label>
                <label>
                  <span className="sr-only">{dayName} opening time</span>
                  <input
                    defaultValue={timeValue(day?.opens_at ?? null, '09:00')}
                    disabled={!isOpen}
                    name={`opens-${dayOfWeek}`}
                    type="time"
                  />
                </label>
                <span>{isOpen ? 'to' : 'Closed'}</span>
                <label>
                  <span className="sr-only">{dayName} closing time</span>
                  <input
                    defaultValue={timeValue(day?.closes_at ?? null, '17:00')}
                    disabled={!isOpen}
                    name={`closes-${dayOfWeek}`}
                    type="time"
                  />
                </label>
              </div>
            );
          })}
        </fieldset>
      </section>

      <section className="settings-section" aria-labelledby="automation-policy">
        <div className="settings-section-heading">
          <h2 id="automation-policy">Notifications and AI policy</h2>
          <p>AI remains opt-in and the budget is a hard workspace policy.</p>
        </div>
        <fieldset className="form-consent">
          <legend>Workspace controls</legend>
          <label>
            <input
              defaultChecked={settings.notifications_enabled}
              name="notificationsEnabled"
              type="checkbox"
            />
            Enable operational notifications
          </label>
          <label>
            <input
              defaultChecked={settings.ai_operations_enabled}
              name="aiOperationsEnabled"
              type="checkbox"
            />
            Allow AI-assisted operations when an AI provider is connected
          </label>
        </fieldset>
        <div className="form-grid">
          <label>
            <span>Monthly AI budget (USD)</span>
            <input
              aria-describedby="aiMonthlyBudgetDollars-help aiMonthlyBudgetDollars-error"
              defaultValue={(settings.ai_monthly_budget_cents / 100).toFixed(2)}
              min="0"
              name="aiMonthlyBudgetDollars"
              step="0.01"
              type="number"
            />
            <small id="aiMonthlyBudgetDollars-help">
              This saves policy only; no AI calls are enabled in Phase 1.
            </small>
            <FieldError
              errors={state.fieldErrors?.aiMonthlyBudgetDollars}
              id="aiMonthlyBudgetDollars-error"
            />
          </label>
        </div>
      </section>

      {state.message ? (
        <p
          className={`form-status form-status-${state.status}`}
          role={state.status === 'error' ? 'alert' : 'status'}
        >
          {state.message}
        </p>
      ) : null}

      <div className="settings-save-bar">
        <p>Changes are recorded in the audit trail.</p>
        <button className="primary-button" disabled={pending} type="submit">
          {pending ? 'Saving...' : 'Save company settings'}
        </button>
      </div>
    </form>
  );
}
