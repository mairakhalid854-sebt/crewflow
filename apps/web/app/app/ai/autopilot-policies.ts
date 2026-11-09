// Autopilot policies the owner can switch on. Keys must match the
// ai_autopilot_policies_key constraint in 202611090001_ai_autopilot.sql.
export const autopilotPolicies = [
  {
    description:
      'Send the 3, 7, and 14-day overdue invoice reminders without waiting for approval. Customers who opted out or bounced are still skipped.',
    key: 'follow_up.payment_reminder',
    label: 'Payment reminders',
  },
  {
    description:
      'Send the review request two days after an invoice is paid, only to customers who agreed to marketing email.',
    key: 'follow_up.review_request',
    label: 'Review requests',
  },
  {
    description:
      'Assign the suggested technician to a job that has nobody assigned yet. Changing an existing assignment always needs a person.',
    key: 'dispatcher.assign_new',
    label: 'First technician assignment',
  },
  {
    description:
      'Save the AI-written work report as a draft. Nothing is sent to the customer until someone publishes it.',
    key: 'report.save_draft',
    label: 'Work report drafts',
  },
  {
    description:
      'Save an invoice draft from the accepted quote or price list. It is not sent until someone sends it.',
    key: 'report.save_invoice_draft',
    label: 'Invoice drafts',
  },
  {
    description:
      'Create the customer and job draft from a finished online request. Booking and price still need your team.',
    key: 'intake.create_draft_records',
    label: 'Online request drafts',
  },
] as const;

export type AutopilotPolicyKey = (typeof autopilotPolicies)[number]['key'];

export const autopilotPolicyKeys: readonly AutopilotPolicyKey[] =
  autopilotPolicies.map((policy) => policy.key);

export function isAutopilotPolicyKey(
  value: unknown,
): value is AutopilotPolicyKey {
  return (
    typeof value === 'string' &&
    (autopilotPolicyKeys as readonly string[]).includes(value)
  );
}

const outcomeLabels: Readonly<Record<string, string>> = {
  executed: 'Done automatically',
  execution_rejected: 'Stopped by a safety check',
  expired: 'Expired before Autopilot ran',
  failed: 'Failed, left for a person',
  skipped_inactive_owner: 'Skipped, owner no longer active',
};

export function autopilotOutcomeLabel(outcome: string): string {
  return outcomeLabels[outcome] ?? outcome;
}

export function autopilotPolicyLabel(key: string): string {
  return autopilotPolicies.find((policy) => policy.key === key)?.label ?? key;
}
