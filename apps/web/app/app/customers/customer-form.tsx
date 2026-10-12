'use client';

import { useActionState } from 'react';

import type { Tables } from '@crewflow/database';

import {
  type CustomerFormState,
  createCustomerAction,
  updateCustomerAction,
} from './actions';

type Customer = Tables<'customers'>;
const initialCustomerFormState: CustomerFormState = { status: 'idle' };

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

export function CustomerForm({ customer }: Readonly<{ customer?: Customer }>) {
  const action = customer ? updateCustomerAction : createCustomerAction;
  const [state, formAction, pending] = useActionState(
    action,
    initialCustomerFormState,
  );

  return (
    <form action={formAction} className="resource-form">
      {customer ? (
        <input name="customerId" type="hidden" value={customer.id} />
      ) : null}

      <div className="form-grid">
        <label>
          <span>First name *</span>
          <input
            aria-describedby="firstName-error"
            defaultValue={customer?.first_name}
            maxLength={80}
            name="firstName"
            required
          />
          <FieldError
            errors={state.fieldErrors?.firstName}
            id="firstName-error"
          />
        </label>
        <label>
          <span>Last name *</span>
          <input
            aria-describedby="lastName-error"
            defaultValue={customer?.last_name}
            maxLength={80}
            name="lastName"
            required
          />
          <FieldError
            errors={state.fieldErrors?.lastName}
            id="lastName-error"
          />
        </label>
        <label>
          <span>Email</span>
          <input
            aria-describedby="email-error"
            defaultValue={customer?.email ?? ''}
            inputMode="email"
            name="email"
            type="email"
          />
          <FieldError errors={state.fieldErrors?.email} id="email-error" />
        </label>
        <label>
          <span>Phone</span>
          <input
            defaultValue={customer?.phone ?? ''}
            inputMode="tel"
            maxLength={30}
            name="phone"
            type="tel"
          />
        </label>
        <label className="form-span-2">
          <span>Street address</span>
          <input
            defaultValue={customer?.street_address ?? ''}
            maxLength={180}
            name="streetAddress"
          />
        </label>
        <label className="form-span-2">
          <span>Address line 2</span>
          <input
            defaultValue={customer?.address_line_2 ?? ''}
            maxLength={120}
            name="addressLine2"
          />
        </label>
        <label>
          <span>City</span>
          <input
            defaultValue={customer?.city ?? ''}
            maxLength={100}
            name="city"
          />
        </label>
        <label>
          <span>State</span>
          <input
            aria-describedby="stateCode-error"
            autoCapitalize="characters"
            defaultValue={customer?.state_code ?? ''}
            maxLength={2}
            name="stateCode"
          />
          <FieldError
            errors={state.fieldErrors?.stateCode}
            id="stateCode-error"
          />
        </label>
        <label>
          <span>ZIP code</span>
          <input
            aria-describedby="postalCode-error"
            defaultValue={customer?.postal_code ?? ''}
            inputMode="numeric"
            maxLength={10}
            name="postalCode"
          />
          <FieldError
            errors={state.fieldErrors?.postalCode}
            id="postalCode-error"
          />
        </label>
        <label className="form-span-2">
          <span>Internal notes</span>
          <textarea
            defaultValue={customer?.notes ?? ''}
            maxLength={2000}
            name="notes"
            rows={5}
          />
        </label>
      </div>

      <fieldset className="form-consent">
        <legend>Communication permissions</legend>
        <label>
          <input
            defaultChecked={customer?.transactional_email_allowed ?? true}
            name="transactionalEmailAllowed"
            type="checkbox"
          />
          Allow service and transactional emails
        </label>
        <label>
          <input
            defaultChecked={customer?.marketing_email_opted_in ?? false}
            name="marketingEmailOptedIn"
            type="checkbox"
          />
          Customer explicitly opted in to marketing emails
        </label>
      </fieldset>

      {state.message ? (
        <p className={`form-status form-status-${state.status}`} role="status">
          {state.message}
        </p>
      ) : null}

      <button className="primary-button" disabled={pending} type="submit">
        {pending ? 'Saving…' : customer ? 'Save customer' : 'Create customer'}
      </button>
    </form>
  );
}
