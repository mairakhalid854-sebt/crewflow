export const membershipRoles = ['owner', 'office', 'technician'] as const;
export type MembershipRole = (typeof membershipRoles)[number];

export const jobStatuses = [
  'new',
  'quoted',
  'accepted',
  'scheduled',
  'in_progress',
  'completed',
  'closed',
  'cancelled',
] as const;
export type JobStatus = (typeof jobStatuses)[number];

export type CurrencyCode = 'USD';

export interface Money {
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
}

export interface TenantContext {
  readonly actorUserId: string;
  readonly membershipId: string;
  readonly role: MembershipRole;
  readonly tenantId: string;
}

export interface DashboardJobSummary {
  readonly customerName: string;
  readonly id: string;
  readonly serviceName: string;
  readonly startsAt: string;
  readonly status: JobStatus;
  readonly technicianName: string | null;
  readonly tenantId: string;
}
