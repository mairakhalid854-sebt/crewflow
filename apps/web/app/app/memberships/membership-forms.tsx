'use client';

import { useActionState } from 'react';

import {
  type MembershipActionState,
  cancelMembershipAction,
  createDueVisitsAction,
  enrollMembershipAction,
  saveMembershipPlanAction,
} from './actions';

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

function Message({ state }: Readonly<{ state: MembershipActionState }>) {
  if (!state.message) return null;
  return (
    <p
      className={
        state.status === 'error' ? 'form-message-error' : 'form-message'
      }
      role={state.status === 'error' ? 'alert' : 'status'}
    >
      {state.message}
    </p>
  );
}

type PlanDraft = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  billing_interval: string;
  visits_per_year: number;
  discount_percent: number;
  service_id: string | null;
  is_active: boolean;
};

export function MembershipPlanForm({
  plan,
  services,
}: Readonly<{
  plan?: PlanDraft;
  services: readonly { id: string; name: string }[];
}>) {
  const [state, action, pending] = useActionState<
    MembershipActionState,
    FormData
  >(saveMembershipPlanAction, { status: 'idle' });
  const key = plan?.id ?? 'new';

  return (
    <form action={action} className="membership-plan-form">
      <input name="planId" type="hidden" value={plan?.id ?? ''} />
      <div className="form-grid">
        <label>
          <span>Plan name *</span>
          <input
            defaultValue={plan?.name ?? ''}
            maxLength={80}
            name="name"
            placeholder="Comfort Club"
            required
          />
          <FieldError errors={state.fieldErrors?.name} id={`name-${key}`} />
        </label>
        <label>
          <span>Price (USD) *</span>
          <input
            defaultValue={plan ? (plan.price_cents / 100).toFixed(2) : '15.00'}
            inputMode="decimal"
            min="0"
            name="price"
            step="0.01"
            type="number"
          />
          <FieldError errors={state.fieldErrors?.price} id={`price-${key}`} />
        </label>
        <label>
          <span>Billed *</span>
          <select
            defaultValue={plan?.billing_interval ?? 'monthly'}
            name="billingInterval"
          >
            <option value="monthly">Every month</option>
            <option value="yearly">Every year</option>
          </select>
        </label>
        <label>
          <span>Visits per year *</span>
          <select
            defaultValue={String(plan?.visits_per_year ?? 2)}
            name="visitsPerYear"
          >
            <option value="1">1 (yearly)</option>
            <option value="2">2 (every 6 months)</option>
            <option value="3">3 (every 4 months)</option>
            <option value="4">4 (every 3 months)</option>
            <option value="6">6 (every 2 months)</option>
            <option value="12">12 (monthly)</option>
          </select>
          <FieldError
            errors={state.fieldErrors?.visitsPerYear}
            id={`visits-${key}`}
          />
        </label>
        <label>
          <span>Member discount on other work (%)</span>
          <input
            defaultValue={plan?.discount_percent ?? 10}
            max="50"
            min="0"
            name="discountPercent"
            step="1"
            type="number"
          />
          <FieldError
            errors={state.fieldErrors?.discountPercent}
            id={`discount-${key}`}
          />
        </label>
        <label>
          <span>Visit service</span>
          <select defaultValue={plan?.service_id ?? ''} name="serviceId">
            <option value="">No specific service</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </label>
        <label className="membership-wide">
          <span>What members get</span>
          <textarea
            defaultValue={plan?.description ?? ''}
            maxLength={600}
            name="description"
            placeholder="Two tune-ups a year, priority scheduling, and 10% off repairs."
            rows={2}
          />
          <FieldError
            errors={state.fieldErrors?.description}
            id={`description-${key}`}
          />
        </label>
      </div>
      <label className="checkbox-field">
        <input
          defaultChecked={plan?.is_active ?? true}
          name="isActive"
          type="checkbox"
        />
        <span>New customers can join this plan</span>
      </label>
      <Message state={state} />
      <button className="primary-button" disabled={pending} type="submit">
        {pending ? 'Saving...' : plan ? 'Save plan' : 'Create plan'}
      </button>
    </form>
  );
}

export function CreateDueVisitsButton() {
  const [state, action, pending] = useActionState<MembershipActionState>(
    createDueVisitsAction,
    { status: 'idle' },
  );
  return (
    <form action={action} className="membership-run">
      <button className="secondary-button" disabled={pending} type="submit">
        {pending ? 'Checking…' : 'Create due visits now'}
      </button>
      <Message state={state} />
    </form>
  );
}

export function CancelMembershipForm({
  membershipId,
}: Readonly<{ membershipId: string }>) {
  const [state, action, pending] = useActionState<
    MembershipActionState,
    FormData
  >(cancelMembershipAction, { status: 'idle' });
  if (state.status === 'success') return <Message state={state} />;
  return (
    <details className="membership-cancel">
      <summary>Cancel</summary>
      <form action={action}>
        <input name="membershipId" type="hidden" value={membershipId} />
        <label>
          <span>Reason</span>
          <input maxLength={240} minLength={3} name="reason" required />
        </label>
        <button className="secondary-button" disabled={pending} type="submit">
          Cancel membership
        </button>
        <Message state={state} />
      </form>
    </details>
  );
}

export function EnrollMembershipForm({
  customerId,
  plans,
  today,
}: Readonly<{
  customerId: string;
  plans: readonly { id: string; name: string }[];
  today: string;
}>) {
  const [state, action, pending] = useActionState<
    MembershipActionState,
    FormData
  >(enrollMembershipAction, { status: 'idle' });
  if (plans.length === 0) {
    return (
      <p className="membership-muted">
        No membership plans yet. The owner can create one in Memberships.
      </p>
    );
  }
  return (
    <form action={action} className="membership-enroll">
      <input name="customerId" type="hidden" value={customerId} />
      <label>
        <span>Plan</span>
        <select name="planId" required>
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Start date</span>
        <input defaultValue={today} name="startedOn" required type="date" />
        <FieldError errors={state.fieldErrors?.startedOn} id="started-error" />
      </label>
      <label>
        <span>First visit</span>
        <input defaultValue={today} name="firstVisitOn" required type="date" />
        <FieldError
          errors={state.fieldErrors?.firstVisitOn}
          id="first-visit-error"
        />
      </label>
      <button className="primary-button" disabled={pending} type="submit">
        {pending ? 'Enrolling…' : 'Add to plan'}
      </button>
      <Message state={state} />
    </form>
  );
}
