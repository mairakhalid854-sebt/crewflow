export type CrewFlowDeepLink =
  | { readonly jobId: string; readonly kind: 'job' }
  | {
      readonly approvalId: string;
      readonly approvalKind: 'invoice' | 'quote' | 'report';
      readonly kind: 'approval';
    };

const UUID =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const jobPattern = new RegExp(`^crewflow://jobs/(${UUID})$`, 'i');
const approvalPattern = new RegExp(
  `^crewflow://approvals/(quote|invoice|report)/(${UUID})$`,
  'i',
);

export function parseCrewFlowDeepLink(
  value: unknown,
): CrewFlowDeepLink | undefined {
  if (typeof value !== 'string' || value.length > 180) return undefined;

  const jobMatch = value.match(jobPattern);
  if (jobMatch?.[1]) {
    return { jobId: jobMatch[1].toLowerCase(), kind: 'job' };
  }

  const approvalMatch = value.match(approvalPattern);
  const approvalKind = approvalMatch?.[1]?.toLowerCase();
  const approvalId = approvalMatch?.[2];
  if (
    approvalId &&
    (approvalKind === 'quote' ||
      approvalKind === 'invoice' ||
      approvalKind === 'report')
  ) {
    return {
      approvalId: approvalId.toLowerCase(),
      approvalKind,
      kind: 'approval',
    };
  }

  return undefined;
}

export function notificationDeepLinkFromData(
  data: Record<string, unknown> | undefined,
): CrewFlowDeepLink | undefined {
  return parseCrewFlowDeepLink(data?.deepLink);
}
