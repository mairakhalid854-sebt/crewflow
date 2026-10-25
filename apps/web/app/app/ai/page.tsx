import Link from 'next/link';

import type { Database } from '@crewflow/database';

import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { createClient } from '../../../lib/supabase/server';

import styles from './ai.module.css';
import { humanize, proposedChangeLines } from './ai-presenters';
import { ApprovalDecisionForm } from './approval-decision-form';

export const dynamic = 'force-dynamic';

type Run = Database['public']['Tables']['ai_agent_runs']['Row'];
type Step = Database['public']['Tables']['ai_run_steps']['Row'];

function formatDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

function formatCost(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    style: 'currency',
  }).format(cents / 100);
}

function runDuration(run: Run): string {
  if (run.duration_ms === null) return 'Not completed';
  if (run.duration_ms < 1000) return `${run.duration_ms} ms`;
  return `${(run.duration_ms / 1000).toFixed(1)} sec`;
}

export default async function AiOperationsPage() {
  const context = await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const [runsResult, approvalsResult] = await Promise.all([
    supabase
      .from('ai_agent_runs')
      .select('*')
      .eq('tenant_id', context.tenantId)
      .order('created_at', { ascending: false })
      .limit(30),
    supabase
      .from('ai_approval_requests')
      .select('*')
      .eq('tenant_id', context.tenantId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  if (runsResult.error || approvalsResult.error) {
    throw new Error('AI operations could not be loaded.');
  }

  const runs = runsResult.data ?? [];
  const approvals = approvalsResult.data ?? [];
  const runIds = runs.map((run) => run.id);
  const stepsResult = runIds.length
    ? await supabase
        .from('ai_run_steps')
        .select('*')
        .in('run_id', runIds)
        .order('sequence_number', { ascending: true })
        .limit(500)
    : { data: [], error: null };

  if (stepsResult.error) throw new Error('AI run traces could not be loaded.');

  const stepsByRun = new Map<string, Step[]>();
  for (const step of stepsResult.data ?? []) {
    const existing = stepsByRun.get(step.run_id) ?? [];
    existing.push(step);
    stepsByRun.set(step.run_id, existing);
  }

  const pendingApprovals = approvals.filter(
    (approval) => approval.status === 'pending',
  );
  const estimatedSpend = runs.reduce(
    (total, run) => total + run.estimated_cost_cents,
    0,
  );

  return (
    <div className="workspace-page">
      <header className="workspace-heading">
        <div>
          <p className="workspace-kicker">Human-controlled automation</p>
          <h1>AI operations</h1>
          <p>
            Inspect redacted runs, trace each decision, and explicitly approve
            or reject sensitive proposed actions.
          </p>
        </div>
        <Link className={styles.dispatcherLink} href="/app/ai/dispatcher">
          Open Dispatcher suggestions
        </Link>
      </header>

      <section className={styles.summary} aria-label="AI operations summary">
        <div>
          <span>Pending approvals</span>
          <strong>{pendingApprovals.length}</strong>
        </div>
        <div>
          <span>Recent runs</span>
          <strong>{runs.length}</strong>
        </div>
        <div>
          <span>Recorded estimate</span>
          <strong>{formatCost(estimatedSpend)}</strong>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.kicker}>Decision queue</p>
            <h2>Human approvals</h2>
          </div>
          <p>Pending requests expire no later than 48 hours after creation.</p>
        </div>

        {approvals.length ? (
          <div className={styles.cardList}>
            {approvals.map((approval) => {
              const changeLines = proposedChangeLines(
                approval.proposed_changes,
              );
              return (
                <article className={styles.approvalCard} key={approval.id}>
                  <div className={styles.cardHeader}>
                    <div>
                      <span
                        className={styles.status}
                        data-status={approval.status}
                      >
                        {humanize(approval.status)}
                      </span>
                      <h3>{humanize(approval.action_kind)}</h3>
                      <p>
                        Created{' '}
                        {formatDate(approval.created_at, context.timeZone)}
                        {' · '}Expires{' '}
                        {formatDate(approval.expires_at, context.timeZone)}
                      </p>
                    </div>
                    <span className={styles.policyTag}>
                      State {approval.target_state_version ?? 'not supplied'}
                    </span>
                  </div>

                  <div className={styles.explanationGrid}>
                    <div>
                      <h4>Why it is proposed</h4>
                      <p>{approval.rationale}</p>
                    </div>
                    <div>
                      <h4>What will happen</h4>
                      <p>{approval.consequences}</p>
                    </div>
                  </div>

                  <div className={styles.changePanel}>
                    <h4>Exact proposed changes</h4>
                    <dl>
                      {changeLines.map((line, index) => (
                        <div key={`${line.path}-${index}`}>
                          <dt>{humanize(line.path)}</dt>
                          <dd>{line.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>

                  {approval.status === 'pending' ? (
                    <ApprovalDecisionForm approvalId={approval.id} />
                  ) : (
                    <p className={styles.decisionRecord}>
                      Decision recorded{' '}
                      {approval.decided_at
                        ? formatDate(approval.decided_at, context.timeZone)
                        : 'by automatic expiry'}
                      {approval.decision_reason
                        ? ` — ${approval.decision_reason}`
                        : ''}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className={styles.emptyPanel}>
            <h3>No approval requests</h3>
            <p>Agent proposals that require a person will appear here.</p>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.kicker}>Redacted evidence</p>
            <h2>Recent runs</h2>
          </div>
          <p>
            Raw prompts and unrestricted tool payloads are not retained here.
          </p>
        </div>

        {runs.length ? (
          <div className={styles.runList}>
            {runs.map((run) => {
              const steps = stepsByRun.get(run.id) ?? [];
              return (
                <details className={styles.runCard} key={run.id}>
                  <summary>
                    <span>
                      <strong>{humanize(run.agent_kind)} agent</strong>
                      <small>{run.redacted_input_summary}</small>
                    </span>
                    <span>
                      <span className={styles.status} data-status={run.status}>
                        {humanize(run.status)}
                      </span>
                      <small>
                        {formatDate(run.created_at, context.timeZone)}
                      </small>
                    </span>
                  </summary>
                  <div className={styles.runBody}>
                    <dl className={styles.runFacts}>
                      <div>
                        <dt>Policy</dt>
                        <dd>{run.policy_version}</dd>
                      </div>
                      <div>
                        <dt>Model boundary</dt>
                        <dd>{`${run.provider} / ${run.model}`}</dd>
                      </div>
                      <div>
                        <dt>Usage</dt>
                        <dd>{`${run.input_tokens + run.output_tokens} tokens`}</dd>
                      </div>
                      <div>
                        <dt>Estimated cost</dt>
                        <dd>{formatCost(run.estimated_cost_cents)}</dd>
                      </div>
                      <div>
                        <dt>Duration</dt>
                        <dd>{runDuration(run)}</dd>
                      </div>
                      <div>
                        <dt>Correlation</dt>
                        <dd className={styles.mono}>{run.correlation_id}</dd>
                      </div>
                    </dl>

                    <div className={styles.trace}>
                      <h4>Trace ({steps.length} steps)</h4>
                      {steps.length ? (
                        <ol>
                          {steps.map((step) => (
                            <li key={step.id}>
                              <div>
                                <strong>{humanize(step.step_kind)}</strong>
                                <span>{step.outcome}</span>
                              </div>
                              <p>{step.redacted_summary}</p>
                              <small>
                                {step.tool_name
                                  ? `Tool: ${step.tool_name} · `
                                  : ''}
                                {step.duration_ms} ms
                              </small>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p>No trace steps were recorded for this run.</p>
                      )}
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        ) : (
          <div className={styles.emptyPanel}>
            <h3>No AI runs yet</h3>
            <p>
              Manual CrewFlow remains available. Governed agent runs will appear
              here when an agent is enabled.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
