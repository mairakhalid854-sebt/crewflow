import {
  proposeDispatchAssignment,
  type DispatchTechnician,
  type DispatchTimeRange,
} from './dispatcher-agent.js';
import type { IntakeValues } from './intake-agent.js';

export interface IntakeQuoteService {
  readonly defaultDurationMinutes: number;
  readonly enabled: boolean;
  readonly id: string;
  readonly name: string;
  readonly requiredSkills: readonly string[];
  readonly taxBehavior: 'exclusive' | 'inclusive' | 'non_taxable';
  readonly tenantId: string;
  readonly unitPriceCents: number;
}

export type IntakeQuoteSlotInput = DispatchTimeRange;

export interface IntakeQuoteSlotPolicyInput {
  readonly collectedValues: IntakeValues;
  readonly conversationId: string;
  readonly conversationStatus: string;
  readonly evaluatedAt: string;
  readonly service: IntakeQuoteService;
  readonly slotCandidates: readonly IntakeQuoteSlotInput[];
  readonly technicians: readonly DispatchTechnician[];
  readonly tenantId: string;
}

export interface IntakeVerifiedSlot extends DispatchTimeRange {
  readonly technicianMembershipId: string;
}

export type IntakeQuoteSlotPolicyResult =
  | {
      readonly escalationReason: string;
      readonly status: 'escalated';
    }
  | {
      readonly exactChanges: {
        readonly customer: { readonly from: null; readonly to: IntakeValues };
        readonly quoteLine: {
          readonly from: null;
          readonly to: {
            readonly description: string;
            readonly quantity: 1;
            readonly taxBehavior: IntakeQuoteService['taxBehavior'];
            readonly unitPriceCents: number;
          };
        };
        readonly slotOptions: {
          readonly from: null;
          readonly to: readonly IntakeVerifiedSlot[];
        };
      };
      readonly rationale: readonly string[];
      readonly requiresHumanApproval: true;
      readonly status: 'proposed';
    };

const MAX_PRICE_CENTS = 100_000_000;

function instant(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function postalCode(address: string): string | undefined {
  return address.match(/\b\d{5}(?:-\d{4})?\b(?!.*\b\d{5}(?:-\d{4})?\b)/)?.[0];
}

function validContact(values: IntakeValues): boolean {
  const contact = values.contact;
  if (!contact) return false;
  return contact.kind === 'email'
    ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.value)
    : /^\+1\d{10}$/.test(contact.value);
}

export function proposeIntakeQuoteAndSlots(
  input: IntakeQuoteSlotPolicyInput,
): IntakeQuoteSlotPolicyResult {
  if (input.conversationStatus !== 'ready_for_human_review') {
    return {
      escalationReason:
        'Intake details must be complete and ready for human review.',
      status: 'escalated',
    };
  }

  const values = input.collectedValues;
  const zip = values.address ? postalCode(values.address) : undefined;
  if (
    !values.customerName ||
    values.customerName.trim().length < 2 ||
    !validContact(values) ||
    !values.address ||
    !zip ||
    !values.problem ||
    values.problem.trim().length < 10 ||
    values.serviceId !== input.service.id
  ) {
    return {
      escalationReason:
        'Intake customer, contact, address, problem, or confirmed service data is incomplete.',
      status: 'escalated',
    };
  }

  if (
    input.service.tenantId !== input.tenantId ||
    input.technicians.some(
      (technician) =>
        technician.tenantId !== input.tenantId ||
        technician.assignments.some(
          (assignment) => assignment.tenantId !== input.tenantId,
        ),
    )
  ) {
    return {
      escalationReason:
        'Intake pricing or availability input contained records from a different workspace.',
      status: 'escalated',
    };
  }

  if (
    !input.service.enabled ||
    !input.service.name.trim() ||
    !Number.isSafeInteger(input.service.unitPriceCents) ||
    input.service.unitPriceCents < 0 ||
    input.service.unitPriceCents > MAX_PRICE_CENTS ||
    !Number.isInteger(input.service.defaultDurationMinutes) ||
    input.service.defaultDurationMinutes < 15 ||
    input.service.defaultDurationMinutes > 1_440
  ) {
    return {
      escalationReason:
        'The confirmed catalog service is not safely quoteable.',
      status: 'escalated',
    };
  }

  const evaluatedAt = instant(input.evaluatedAt);
  if (evaluatedAt === undefined) {
    return {
      escalationReason: 'Evaluation time is invalid.',
      status: 'escalated',
    };
  }

  const uniqueCandidates = new Map<string, IntakeQuoteSlotInput>();
  for (const candidate of input.slotCandidates) {
    const start = instant(candidate.startsAt);
    const end = instant(candidate.endsAt);
    if (
      start === undefined ||
      end === undefined ||
      start <= evaluatedAt ||
      end <= start ||
      end - start !== input.service.defaultDurationMinutes * 60_000
    ) {
      continue;
    }
    uniqueCandidates.set(
      `${candidate.startsAt}|${candidate.endsAt}`,
      candidate,
    );
  }

  const verifiedSlots: IntakeVerifiedSlot[] = [];
  for (const candidate of [...uniqueCandidates.values()].sort(
    (left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt),
  )) {
    const dispatch = proposeDispatchAssignment(
      {
        ...candidate,
        id: `intake:${input.conversationId}:${candidate.startsAt}`,
        requiredSkills: input.service.requiredSkills,
        servicePostalCode: zip,
        status: 'accepted',
        tenantId: input.tenantId,
      },
      input.technicians,
    );
    if (dispatch.status === 'proposed' || dispatch.status === 'unchanged') {
      verifiedSlots.push({
        ...candidate,
        technicianMembershipId: dispatch.technicianMembershipId,
      });
    }
    if (verifiedSlots.length === 2) break;
  }

  if (verifiedSlots.length < 2) {
    return {
      escalationReason:
        'Two verified technician slots are not currently available. Office scheduling is required.',
      status: 'escalated',
    };
  }

  return {
    exactChanges: {
      customer: { from: null, to: values },
      quoteLine: {
        from: null,
        to: {
          description: input.service.name.trim(),
          quantity: 1,
          taxBehavior: input.service.taxBehavior,
          unitPriceCents: input.service.unitPriceCents,
        },
      },
      slotOptions: { from: null, to: verifiedSlots },
    },
    rationale: [
      'Customer details came from the validated Intake conversation.',
      'The quote line uses the confirmed enabled tenant catalog service and exact stored price.',
      'Both slot options passed technician status, skill, ZIP, availability, and conflict checks.',
      'No customer, job, quote, assignment, or booking is created without office approval.',
    ],
    requiresHumanApproval: true,
    status: 'proposed',
  };
}
