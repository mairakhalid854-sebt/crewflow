'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

import type { Tables } from '@crewflow/database';

import {
  type WorkReportActionState,
  publishWorkReportAction,
  requestAiReportProposalAction,
} from './report-actions';

type WorkReport = Tables<'work_reports'>;

const initialState: WorkReportActionState = { status: 'idle' };

export function WorkReportPanel({
  jobId,
  jobStatus,
  report,
}: Readonly<{
  jobId: string;
  jobStatus: string;
  report?: WorkReport;
}>) {
  const [state, formAction, pending] = useActionState(
    publishWorkReportAction,
    initialState,
  );
  const [proposalState, proposalAction, proposing] = useActionState(
    requestAiReportProposalAction,
    initialState,
  );
  const [copied, setCopied] = useState(false);
  const jobCanReport = ['completed', 'closed'].includes(jobStatus);
  const canEdit = jobCanReport && (!report || report.status !== 'draft');

  return (
    <section className="team-panel quote-panel report-panel">
      <div className="team-panel-heading">
        <div>
          <h2>Work report</h2>
          <p>Reviewed customer summary of the completed service.</p>
        </div>
        <div className="panel-heading-actions">
          {jobCanReport && (!report || report.status === 'draft') ? (
            <form action={proposalAction}>
              <input name="jobId" type="hidden" value={jobId} />
              <button
                className="secondary-button"
                disabled={proposing}
                type="submit"
              >
                {proposing ? 'Evaluating...' : 'Prepare AI draft'}
              </button>
            </form>
          ) : null}
          {report?.status === 'draft' || canEdit ? (
            <Link
              className="secondary-button"
              href={`/app/jobs/${jobId}/report`}
            >
              {report?.status === 'draft'
                ? 'Edit draft'
                : report
                  ? 'Create revision'
                  : 'Create report'}
            </Link>
          ) : null}
        </div>
      </div>

      {proposalState.message ? (
        <p
          className={`form-status form-status-${proposalState.status}`}
          role="status"
        >
          {proposalState.message}
        </p>
      ) : null}

      {!report ? (
        <p className="form-help">
          {jobCanReport
            ? 'No work report has been created for this job.'
            : 'Work reports become available when the job is completed.'}
        </p>
      ) : (
        <>
          <div className="quote-summary-row">
            <span className={`status-badge status-report-${report.status}`}>
              {report.status}
            </span>
            <span>
              {report.status === 'draft'
                ? 'Awaiting owner or office approval'
                : 'Customer-safe snapshot'}
            </span>
          </div>
          <div className="report-preview">
            <h3>Summary</h3>
            <p>{report.summary}</p>
            <h3>Work performed</h3>
            <p>{report.work_performed}</p>
          </div>

          {report.status === 'draft' ? (
            <form action={formAction} className="quote-publish-form">
              <input name="jobId" type="hidden" value={jobId} />
              <input name="reportId" type="hidden" value={report.id} />
              <p className="form-help">
                Approval locks this snapshot and creates a secure customer link.
                Review every statement before continuing.
              </p>
              <button
                className="primary-button"
                disabled={pending}
                type="submit"
              >
                {pending ? 'Approving...' : 'Approve and create customer link'}
              </button>
            </form>
          ) : (
            <p className="form-help">
              The secure customer link was shown once at approval. Create a
              revision to replace a lost or outdated report link.
            </p>
          )}
        </>
      )}

      {state.message ? (
        <p className={`form-status form-status-${state.status}`} role="status">
          {state.message}
        </p>
      ) : null}
      {state.shareUrl ? (
        <div className="secure-link-result">
          <label>
            Secure customer work report link
            <input readOnly value={state.shareUrl} />
          </label>
          <button
            className="secondary-button"
            onClick={() => {
              void navigator.clipboard.writeText(state.shareUrl ?? '');
              setCopied(true);
            }}
            type="button"
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
