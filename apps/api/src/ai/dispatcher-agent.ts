export type DispatchJobStatus =
  | 'accepted'
  | 'cancelled'
  | 'closed'
  | 'completed'
  | 'in_progress'
  | 'new'
  | 'quoted'
  | 'scheduled';

export interface DispatchTimeRange {
  readonly endsAt: string;
  readonly startsAt: string;
}

export interface DispatchAssignment extends DispatchTimeRange {
  readonly jobId: string;
  readonly tenantId: string;
}

export interface DispatchTechnician {
  readonly active: boolean;
  readonly availability: readonly DispatchTimeRange[];
  readonly assignments: readonly DispatchAssignment[];
  readonly membershipId: string;
  readonly serviceAreaPostalCodes: readonly string[];
  readonly skills: readonly string[];
  readonly tenantId: string;
}

export interface DispatchJob extends DispatchTimeRange {
  readonly assignedMembershipId?: string;
  readonly id: string;
  readonly requiredSkills: readonly string[];
  readonly servicePostalCode: string;
  readonly status: DispatchJobStatus;
  readonly tenantId: string;
}

export type DispatchRejectionCode =
  | 'inactive'
  | 'missing_skill'
  | 'outside_availability'
  | 'outside_service_area'
  | 'schedule_conflict';

export interface DispatchCandidateRejection {
  readonly membershipId: string;
  readonly reasons: readonly DispatchRejectionCode[];
}

export type DispatchResult =
  | {
      readonly candidateRejections: readonly DispatchCandidateRejection[];
      readonly escalationReason: string;
      readonly status: 'escalated';
    }
  | {
      readonly rationale: readonly string[];
      readonly status: 'unchanged';
      readonly technicianMembershipId: string;
    }
  | {
      readonly exactChanges: {
        readonly assignedMembershipId: {
          readonly from: string | null;
          readonly to: string;
        };
      };
      readonly rationale: readonly string[];
      readonly requiresHumanApproval: boolean;
      readonly status: 'proposed';
      readonly technicianMembershipId: string;
    };

interface RankedTechnician {
  readonly assignmentCount: number;
  readonly scheduledMinutes: number;
  readonly technician: DispatchTechnician;
}

function epoch(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function validRange(range: DispatchTimeRange): boolean {
  const start = epoch(range.startsAt);
  const end = epoch(range.endsAt);
  return start !== undefined && end !== undefined && end > start;
}

function contains(
  available: DispatchTimeRange,
  requested: DispatchTimeRange,
): boolean {
  const availableStart = epoch(available.startsAt)!;
  const availableEnd = epoch(available.endsAt)!;
  const requestedStart = epoch(requested.startsAt)!;
  const requestedEnd = epoch(requested.endsAt)!;
  return availableStart <= requestedStart && availableEnd >= requestedEnd;
}

function overlaps(left: DispatchTimeRange, right: DispatchTimeRange): boolean {
  return (
    epoch(left.startsAt)! < epoch(right.endsAt)! &&
    epoch(left.endsAt)! > epoch(right.startsAt)!
  );
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function workload(technician: DispatchTechnician): RankedTechnician {
  const validAssignments = technician.assignments.filter(validRange);
  return {
    assignmentCount: validAssignments.length,
    scheduledMinutes: validAssignments.reduce(
      (total, assignment) =>
        total +
        (epoch(assignment.endsAt)! - epoch(assignment.startsAt)!) / 60_000,
      0,
    ),
    technician,
  };
}

export function proposeDispatchAssignment(
  job: DispatchJob,
  technicians: readonly DispatchTechnician[],
): DispatchResult {
  if (!validRange(job)) {
    return {
      candidateRejections: [],
      escalationReason: 'The job has no valid scheduled time range.',
      status: 'escalated',
    };
  }

  if (!/^\d{5}(-\d{4})?$/.test(job.servicePostalCode)) {
    return {
      candidateRejections: [],
      escalationReason: 'The job needs a valid US service ZIP code.',
      status: 'escalated',
    };
  }

  if (
    technicians.some(
      (technician) =>
        technician.tenantId !== job.tenantId ||
        technician.assignments.some(
          (assignment) => assignment.tenantId !== job.tenantId,
        ),
    )
  ) {
    return {
      candidateRejections: [],
      escalationReason:
        'Dispatcher input contained records from a different workspace.',
      status: 'escalated',
    };
  }

  const requiredSkills = new Set(job.requiredSkills.map(normalized));
  const rejected: DispatchCandidateRejection[] = [];
  const eligible: RankedTechnician[] = [];

  for (const technician of technicians) {
    const reasons: DispatchRejectionCode[] = [];
    const technicianSkills = new Set(technician.skills.map(normalized));
    if (!technician.active) reasons.push('inactive');
    if ([...requiredSkills].some((skill) => !technicianSkills.has(skill))) {
      reasons.push('missing_skill');
    }
    if (!technician.serviceAreaPostalCodes.includes(job.servicePostalCode)) {
      reasons.push('outside_service_area');
    }
    if (
      !technician.availability.some(
        (range) => validRange(range) && contains(range, job),
      )
    ) {
      reasons.push('outside_availability');
    }
    if (
      technician.assignments.some(
        (assignment) =>
          assignment.jobId !== job.id &&
          validRange(assignment) &&
          overlaps(assignment, job),
      )
    ) {
      reasons.push('schedule_conflict');
    }

    if (reasons.length) {
      rejected.push({ membershipId: technician.membershipId, reasons });
    } else {
      eligible.push(workload(technician));
    }
  }

  eligible.sort(
    (left, right) =>
      left.scheduledMinutes - right.scheduledMinutes ||
      left.assignmentCount - right.assignmentCount ||
      left.technician.membershipId.localeCompare(
        right.technician.membershipId,
        'en-US',
      ),
  );

  const selected = eligible[0];
  if (!selected) {
    return {
      candidateRejections: rejected,
      escalationReason:
        technicians.length === 0
          ? 'No active technician records were supplied for this workspace.'
          : 'No technician satisfies the required skills, service area, availability, and conflict checks.',
      status: 'escalated',
    };
  }

  const rationale = [
    'All required skills match.',
    'The job ZIP is inside the technician service area.',
    'The requested interval is inside availability with no schedule conflict.',
    `Lowest eligible supplied workload: ${selected.assignmentCount} assignments / ${Math.round(selected.scheduledMinutes)} minutes.`,
  ];

  if (job.assignedMembershipId === selected.technician.membershipId) {
    return {
      rationale,
      status: 'unchanged',
      technicianMembershipId: selected.technician.membershipId,
    };
  }

  return {
    exactChanges: {
      assignedMembershipId: {
        from: job.assignedMembershipId ?? null,
        to: selected.technician.membershipId,
      },
    },
    rationale,
    requiresHumanApproval:
      job.status === 'in_progress' && Boolean(job.assignedMembershipId),
    status: 'proposed',
    technicianMembershipId: selected.technician.membershipId,
  };
}
