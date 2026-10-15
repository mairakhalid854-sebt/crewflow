'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

import {
  type WorkReportActionState,
  saveWorkReportAction,
} from './report-actions';

const initialState: WorkReportActionState = { status: 'idle' };

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

export function WorkReportForm({
  initialPartsUsed,
  initialRecommendations,
  initialSummary,
  initialWorkPerformed,
  jobId,
}: Readonly<{
  initialPartsUsed: string;
  initialRecommendations: string;
  initialSummary: string;
  initialWorkPerformed: string;
  jobId: string;
}>) {
  const [state, formAction, pending] = useActionState(
    saveWorkReportAction,
    initialState,
  );
  const [summary, setSummary] = useState(initialSummary);
  const [workPerformed, setWorkPerformed] = useState(initialWorkPerformed);
  const [partsUsed, setPartsUsed] = useState(initialPartsUsed);
  const [recommendations, setRecommendations] = useState(
    initialRecommendations,
  );

  return (
    <form action={formAction} className="resource-form report-form">
      <input name="jobId" type="hidden" value={jobId} />
      <label>
        <span>Customer summary *</span>
        <textarea
          aria-describedby="report-summary-error"
          maxLength={5000}
          name="summary"
          onChange={(event) => setSummary(event.target.value)}
          required
          rows={4}
          value={summary}
        />
        <FieldError
          errors={state.fieldErrors?.summary}
          id="report-summary-error"
        />
      </label>
      <label>
        <span>Work performed *</span>
        <textarea
          aria-describedby="report-work-error"
          maxLength={10_000}
          name="workPerformed"
          onChange={(event) => setWorkPerformed(event.target.value)}
          required
          rows={7}
          value={workPerformed}
        />
        <FieldError
          errors={state.fieldErrors?.workPerformed}
          id="report-work-error"
        />
      </label>
      <label>
        <span>Parts used (optional)</span>
        <textarea
          aria-describedby="report-parts-error"
          maxLength={5000}
          name="partsUsed"
          onChange={(event) => setPartsUsed(event.target.value)}
          rows={3}
          value={partsUsed}
        />
        <FieldError
          errors={state.fieldErrors?.partsUsed}
          id="report-parts-error"
        />
      </label>
      <label>
        <span>Recommendations (optional)</span>
        <textarea
          aria-describedby="report-recommendations-error"
          maxLength={5000}
          name="recommendations"
          onChange={(event) => setRecommendations(event.target.value)}
          rows={4}
          value={recommendations}
        />
        <FieldError
          errors={state.fieldErrors?.recommendations}
          id="report-recommendations-error"
        />
      </label>

      <p className="form-help">
        This remains an internal draft until an owner or office user explicitly
        approves it from the job page.
      </p>
      {state.message ? (
        <p className={`form-status form-status-${state.status}`} role="status">
          {state.message}
        </p>
      ) : null}
      <div className="report-form-actions">
        <button className="primary-button" disabled={pending} type="submit">
          {pending ? 'Saving...' : 'Save draft report'}
        </button>
        {state.status === 'success' ? (
          <Link className="secondary-button" href={`/app/jobs/${jobId}`}>
            Review on job
          </Link>
        ) : null}
      </div>
    </form>
  );
}
