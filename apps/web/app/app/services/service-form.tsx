'use client';

import { useActionState } from 'react';

import type { Tables } from '@crewflow/database';

import {
  type ServiceFormState,
  createServiceAction,
  updateServiceAction,
} from './actions';

type Service = Tables<'services'>;
const initialServiceFormState: ServiceFormState = { status: 'idle' };

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

export function ServiceForm({ service }: Readonly<{ service?: Service }>) {
  const action = service ? updateServiceAction : createServiceAction;
  const [state, formAction, pending] = useActionState(
    action,
    initialServiceFormState,
  );

  return (
    <form action={formAction} className="resource-form">
      {service ? (
        <input name="serviceId" type="hidden" value={service.id} />
      ) : null}

      <div className="form-grid">
        <label className="form-span-2">
          <span>Service name *</span>
          <input
            aria-describedby="service-name-error"
            defaultValue={service?.name}
            maxLength={120}
            name="name"
            required
          />
          <FieldError
            errors={state.fieldErrors?.name}
            id="service-name-error"
          />
        </label>
        <label>
          <span>Unit price (USD) *</span>
          <input
            aria-describedby="unit-price-error"
            defaultValue={
              service ? (service.unit_price_cents / 100).toFixed(2) : ''
            }
            inputMode="decimal"
            min="0"
            name="unitPrice"
            placeholder="0.00"
            required
            step="0.01"
            type="number"
          />
          <FieldError
            errors={state.fieldErrors?.unitPrice}
            id="unit-price-error"
          />
        </label>
        <label>
          <span>Default duration (minutes) *</span>
          <input
            aria-describedby="duration-error"
            defaultValue={service?.default_duration_minutes ?? 60}
            max={1440}
            min={5}
            name="defaultDurationMinutes"
            required
            step={1}
            type="number"
          />
          <FieldError
            errors={state.fieldErrors?.defaultDurationMinutes}
            id="duration-error"
          />
        </label>
        <label>
          <span>Tax behavior *</span>
          <select
            defaultValue={service?.tax_behavior ?? 'exclusive'}
            name="taxBehavior"
          >
            <option value="exclusive">Tax added at checkout</option>
            <option value="inclusive">Tax included in price</option>
            <option value="non_taxable">Non-taxable</option>
          </select>
        </label>
        <label className="checkbox-field">
          <input
            defaultChecked={service?.is_enabled ?? true}
            name="isEnabled"
            type="checkbox"
          />
          Service is available for new work
        </label>
        <label className="form-span-2">
          <span>Required technician skills</span>
          <input
            aria-describedby="required-skills-help required-skills-error"
            defaultValue={service?.required_skills.join(', ') ?? ''}
            maxLength={1000}
            name="requiredSkills"
            placeholder="HVAC repair, Diagnostics"
          />
          <small className="form-help" id="required-skills-help">
            Separate up to 20 skills with commas. An assigned technician must
            have every listed skill.
          </small>
          <FieldError
            errors={state.fieldErrors?.requiredSkills}
            id="required-skills-error"
          />
        </label>
        <label className="form-span-2">
          <span>Description</span>
          <textarea
            defaultValue={service?.description ?? ''}
            maxLength={2000}
            name="description"
            rows={5}
          />
        </label>
      </div>

      {state.message ? (
        <p className={`form-status form-status-${state.status}`} role="status">
          {state.message}
        </p>
      ) : null}

      <button className="primary-button" disabled={pending} type="submit">
        {pending ? 'Saving…' : service ? 'Save service' : 'Create service'}
      </button>
    </form>
  );
}
