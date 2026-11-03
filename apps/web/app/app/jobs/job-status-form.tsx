'use client';

import { useActionState } from 'react';

import { type JobFormState, updateJobStatusAction } from './actions';
import { type JobStatus, jobStatusLabels, nextJobStatuses } from './job-status';

const initialState: JobFormState = { status: 'idle' };

export function JobStatusForm({
  jobId,
  status,
}: Readonly<{ jobId: string; status: JobStatus }>) {
  const [state, formAction, pending] = useActionState(
    updateJobStatusAction,
    initialState,
  );
  const nextStatuses = nextJobStatuses[status];

  if (nextStatuses.length === 0) {
    return <p className="form-help">This workflow is in a final state.</p>;
  }

  return (
    <form action={formAction} className="status-change-form">
      <input name="jobId" type="hidden" value={jobId} />
      <label>
        <span>Move job to</span>
        <select defaultValue={nextStatuses[0]} name="status">
          {nextStatuses.map((nextStatus) => (
            <option key={nextStatus} value={nextStatus}>
              {jobStatusLabels[nextStatus]}
            </option>
          ))}
        </select>
      </label>
      <button className="primary-button" disabled={pending} type="submit">
        {pending ? 'Updating…' : 'Update status'}
      </button>
      {state.message ? (
        <p className={`form-status form-status-${state.status}`} role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
