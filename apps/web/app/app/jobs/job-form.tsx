'use client';

import { useActionState } from 'react';

import type { Tables } from '@crewflow/database';

import { type JobFormState, createJobAction, updateJobAction } from './actions';

type Job = Tables<'jobs'>;

interface JobOption {
  readonly id: string;
  readonly label: string;
}

interface JobFormProps {
  readonly customers: readonly JobOption[];
  readonly job?: Job;
  readonly scheduledEndLocal?: string;
  readonly scheduledStartLocal?: string;
  readonly services: readonly JobOption[];
  readonly technicians: readonly JobOption[];
  readonly timeZone: string;
}

const initialState: JobFormState = { status: 'idle' };

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

export function JobForm({
  customers,
  job,
  scheduledEndLocal,
  scheduledStartLocal,
  services,
  technicians,
  timeZone,
}: Readonly<JobFormProps>) {
  const action = job ? updateJobAction : createJobAction;
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="resource-form">
      {job ? <input name="jobId" type="hidden" value={job.id} /> : null}

      <div className="form-grid">
        <label className="form-span-2">
          <span>Job title *</span>
          <input
            aria-describedby="job-title-error"
            defaultValue={job?.title}
            maxLength={160}
            name="title"
            placeholder="e.g. Air conditioner not cooling"
            required
          />
          <FieldError errors={state.fieldErrors?.title} id="job-title-error" />
        </label>

        <label>
          <span>Customer *</span>
          <select
            aria-describedby="job-customer-error"
            defaultValue={job?.customer_id ?? ''}
            name="customerId"
            required
          >
            <option disabled value="">
              Select customer
            </option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.label}
              </option>
            ))}
          </select>
          <FieldError
            errors={state.fieldErrors?.customerId}
            id="job-customer-error"
          />
        </label>

        <label>
          <span>Service</span>
          <select defaultValue={job?.service_id ?? ''} name="serviceId">
            <option value="">No catalog service</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Priority *</span>
          <select defaultValue={job?.priority ?? 'normal'} name="priority">
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>

        <label>
          <span>Assigned technician</span>
          <select
            aria-describedby="job-technician-error"
            defaultValue={job?.assigned_membership_id ?? ''}
            name="assignedMembershipId"
          >
            <option value="">Unassigned</option>
            {technicians.map((technician) => (
              <option key={technician.id} value={technician.id}>
                {technician.label}
              </option>
            ))}
          </select>
          <FieldError
            errors={state.fieldErrors?.assignedMembershipId}
            id="job-technician-error"
          />
        </label>

        <label>
          <span>Scheduled start</span>
          <input
            defaultValue={scheduledStartLocal}
            name="scheduledStartLocal"
            type="datetime-local"
          />
        </label>

        <label>
          <span>Scheduled end</span>
          <input
            aria-describedby="job-end-error"
            defaultValue={scheduledEndLocal}
            name="scheduledEndLocal"
            type="datetime-local"
          />
          <FieldError
            errors={state.fieldErrors?.scheduledEndLocal}
            id="job-end-error"
          />
        </label>

        <p className="form-help form-span-2">
          Times use the company time zone: <strong>{timeZone}</strong>.
        </p>

        <label className="form-span-2">
          <span>Description</span>
          <textarea
            defaultValue={job?.description ?? ''}
            maxLength={5000}
            name="description"
            rows={6}
          />
        </label>
      </div>

      {state.message ? (
        <p className={`form-status form-status-${state.status}`} role="status">
          {state.message}
        </p>
      ) : null}

      <button className="primary-button" disabled={pending} type="submit">
        {pending ? 'Saving…' : job ? 'Save job' : 'Create job'}
      </button>
    </form>
  );
}
