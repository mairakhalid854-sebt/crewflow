import styles from './ai.module.css';
import {
  autopilotOutcomeLabel,
  autopilotPolicies,
  autopilotPolicyLabel,
} from './autopilot-policies';
import { AutopilotToggle } from './autopilot-toggle';

interface AutopilotExecution {
  readonly approval_id: string;
  readonly created_at: string;
  readonly outcome: string;
  readonly policy_key: string;
}

interface AutopilotPanelProps {
  readonly aiEnabled: boolean;
  readonly canEdit: boolean;
  readonly enabledKeys: ReadonlySet<string>;
  readonly executions: readonly AutopilotExecution[];
  readonly timeZone: string;
}

function formatDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

export function AutopilotPanel({
  aiEnabled,
  canEdit,
  enabledKeys,
  executions,
  timeZone,
}: AutopilotPanelProps) {
  return (
    <section aria-labelledby="autopilot-title" className={styles.section}>
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.kicker}>Autopilot</p>
          <h2 id="autopilot-title">Let routine work run by itself</h2>
        </div>
        <p>
          Everything starts off. Turn on only what you trust. Every action still
          passes the same safety checks as a manual approval and is logged.
        </p>
      </div>

      {!aiEnabled ? (
        <p className={styles.autopilotNotice} role="status">
          AI operations are turned off in Settings, so Autopilot is paused.
        </p>
      ) : null}
      {!canEdit ? (
        <p className={styles.autopilotNotice}>
          Only the workspace owner can change Autopilot.
        </p>
      ) : null}

      <ul className={styles.autopilotList}>
        {autopilotPolicies.map((policy) => (
          <li className={styles.autopilotRow} key={policy.key}>
            <div>
              <h3>{policy.label}</h3>
              <p>{policy.description}</p>
            </div>
            <AutopilotToggle
              canEdit={canEdit}
              enabled={enabledKeys.has(policy.key)}
              label={policy.label}
              policyKey={policy.key}
            />
          </li>
        ))}
      </ul>

      <div>
        <h3 className={styles.autopilotActivityTitle}>
          Recent Autopilot activity
        </h3>
        {executions.length ? (
          <ul className={styles.autopilotActivity}>
            {executions.map((execution) => (
              <li key={execution.approval_id}>
                <span>{autopilotPolicyLabel(execution.policy_key)}</span>
                <span data-outcome={execution.outcome}>
                  {autopilotOutcomeLabel(execution.outcome)}
                </span>
                <time dateTime={execution.created_at}>
                  {formatDate(execution.created_at, timeZone)}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.autopilotEmpty}>
            Nothing yet. Autopilot checks for new work every two minutes.
          </p>
        )}
      </div>
    </section>
  );
}
