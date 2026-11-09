'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useMemo, useState, useTransition } from 'react';

import type { Tables } from '@crewflow/database';

import { missingSkills } from '../../../lib/skills';
import { addServiceSkillsToTechnicianAction } from '../team/actions';
import { type JobFormState, createJobAction, updateJobAction } from './actions';

type Job = Tables<'jobs'>;

interface JobOption {
  readonly id: string;
  readonly label: string;
}

export interface JobServiceOption extends JobOption {
  readonly requiredSkills: readonly string[];
}

export interface JobTechnicianOption extends JobOption {
  readonly skills: readonly string[];
}

interface JobFormProps {
  readonly customers: readonly JobOption[];
  readonly job?: Job;
  readonly scheduledEndLocal?: string;
  readonly scheduledStartLocal?: string;
  readonly services: readonly JobServiceOption[];
  readonly technicianIdOverride?: string;
  readonly technicians: readonly JobTechnicianOption[];
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

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function JobForm({
  customers,
  job,
  scheduledEndLocal,
  scheduledStartLocal,
  services,
  technicianIdOverride,
  technicians,
  timeZone,
}: Readonly<JobFormProps>) {
  const action = job ? updateJobAction : createJobAction;
  const [state, formAction, pending] = useActionState(action, initialState);
  const router = useRouter();

  // Controlled fields keep what the owner typed when the server returns an
  // error; React resets uncontrolled fields after every form action.
  const [title, setTitle] = useState(job?.title ?? '');
  const [customerId, setCustomerId] = useState(job?.customer_id ?? '');
  const [serviceId, setServiceId] = useState(job?.service_id ?? '');
  const [priority, setPriority] = useState<string>(job?.priority ?? 'normal');
  const [technicianId, setTechnicianId] = useState(
    technicianIdOverride ?? job?.assigned_membership_id ?? '',
  );
  const [description, setDescription] = useState(job?.description ?? '');
  const [scheduledStart, setScheduledStart] = useState(
    scheduledStartLocal ?? '',
  );
  const [scheduledEnd, setScheduledEnd] = useState(scheduledEndLocal ?? '');

  // Skills added from this form, shown immediately while the page refreshes.
  const [addedSkills, setAddedSkills] = useState<
    Readonly<Record<string, readonly string[]>>
  >({});
  const [skillMessage, setSkillMessage] = useState<{
    readonly status: 'error' | 'success';
    readonly text: string;
  } | null>(null);
  const [addingSkills, startAddingSkills] = useTransition();

  const service = services.find((option) => option.id === serviceId);
  const requiredSkills = service?.requiredSkills ?? [];

  const technicianSkills = useMemo(
    () =>
      new Map(
        technicians.map((technician) => [
          technician.id,
          [...technician.skills, ...(addedSkills[technician.id] ?? [])],
        ]),
      ),
    [addedSkills, technicians],
  );

  function missingFor(id: string): string[] {
    return missingSkills(requiredSkills, technicianSkills.get(id) ?? []);
  }

  const technician = technicians.find((option) => option.id === technicianId);
  const missing = technician ? missingFor(technician.id) : [];

  function addMissingSkills() {
    if (!technician || !service) return;
    setSkillMessage(null);
    startAddingSkills(async () => {
      const result = await addServiceSkillsToTechnicianAction(
        technician.id,
        service.id,
      );
      if (result.status === 'success') {
        setAddedSkills((current) => ({
          ...current,
          [technician.id]: [
            ...(current[technician.id] ?? []),
            ...(result.addedSkills ?? []),
          ],
        }));
        router.refresh();
      }
      setSkillMessage({ status: result.status, text: result.message });
    });
  }

  return (
    <form action={formAction} className="resource-form" id="job-form">
      {job ? <input name="jobId" type="hidden" value={job.id} /> : null}

      <div className="form-grid">
        <label className="form-span-2">
          <span>Job title *</span>
          <input
            aria-describedby="job-title-error"
            maxLength={160}
            name="title"
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Air conditioner not cooling"
            required
            value={title}
          />
          <FieldError errors={state.fieldErrors?.title} id="job-title-error" />
        </label>

        <label>
          <span>Customer *</span>
          <select
            aria-describedby="job-customer-error"
            name="customerId"
            onChange={(event) => setCustomerId(event.target.value)}
            required
            value={customerId}
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
          <select
            aria-describedby="job-service-skills"
            name="serviceId"
            onChange={(event) => {
              setServiceId(event.target.value);
              setSkillMessage(null);
            }}
            value={serviceId}
          >
            <option value="">No catalog service</option>
            {services.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          {requiredSkills.length ? (
            <small className="form-help" id="job-service-skills">
              Requires: {requiredSkills.join(', ')}
            </small>
          ) : null}
        </label>

        <label>
          <span>Priority *</span>
          <select
            name="priority"
            onChange={(event) => setPriority(event.target.value)}
            value={priority}
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>

        <label>
          <span>Assigned technician</span>
          <select
            aria-describedby="job-technician-error job-skill-check"
            name="assignedMembershipId"
            onChange={(event) => {
              setTechnicianId(event.target.value);
              setSkillMessage(null);
            }}
            value={technicianId}
          >
            <option value="">Unassigned</option>
            {technicians.map((option) => {
              const gaps = requiredSkills.length ? missingFor(option.id) : [];
              return (
                <option key={option.id} value={option.id}>
                  {gaps.length
                    ? `${option.label} (missing ${plural(gaps.length, 'skill')})`
                    : requiredSkills.length
                      ? `${option.label} ✓`
                      : option.label}
                </option>
              );
            })}
          </select>
          <FieldError
            errors={state.fieldErrors?.assignedMembershipId}
            id="job-technician-error"
          />
        </label>

        {technician && service && missing.length ? (
          <div
            className="skill-check skill-check-warning form-span-2"
            id="job-skill-check"
            role="status"
          >
            <p>
              <strong>{technician.label}</strong> is missing{' '}
              {plural(missing.length, 'skill')} that{' '}
              <strong>{service.label}</strong> requires:
            </p>
            <ul className="skill-chips">
              {missing.map((skill) => (
                <li key={skill}>{skill}</li>
              ))}
            </ul>
            <div className="skill-check-actions">
              <button
                className="secondary-button"
                disabled={addingSkills}
                onClick={addMissingSkills}
                type="button"
              >
                {addingSkills
                  ? 'Adding skills…'
                  : `Add ${missing.length === 1 ? 'this skill' : 'these skills'} to ${technician.label}`}
              </button>
              <Link href={`/app/team/${technician.id}`} target="_blank">
                Edit technician skills
              </Link>
              <Link href={`/app/services/${service.id}`} target="_blank">
                Edit service requirements
              </Link>
            </div>
          </div>
        ) : null}

        {technician && service && requiredSkills.length && !missing.length ? (
          <p
            className="skill-check skill-check-ok form-span-2"
            id="job-skill-check"
            role="status"
          >
            ✓ {technician.label} has every skill {service.label} requires.
          </p>
        ) : null}

        {skillMessage ? (
          <p
            className={`form-status form-status-${skillMessage.status} form-span-2`}
            role="status"
          >
            {skillMessage.text}
          </p>
        ) : null}

        <label>
          <span>Scheduled start</span>
          <input
            name="scheduledStartLocal"
            onChange={(event) => setScheduledStart(event.target.value)}
            step={60}
            type="datetime-local"
            value={scheduledStart}
          />
        </label>

        <label>
          <span>Scheduled end</span>
          <input
            aria-describedby="job-end-error"
            name="scheduledEndLocal"
            onChange={(event) => setScheduledEnd(event.target.value)}
            step={60}
            type="datetime-local"
            value={scheduledEnd}
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
            maxLength={5000}
            name="description"
            onChange={(event) => setDescription(event.target.value)}
            rows={6}
            value={description}
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
