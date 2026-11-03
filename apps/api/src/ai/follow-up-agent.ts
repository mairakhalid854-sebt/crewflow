export type InvoiceFollowUpStatus =
  'draft' | 'sent' | 'partially_paid' | 'paid' | 'void';

export type PaymentStateSource = 'manual' | 'provider_confirmed';

export interface FollowUpInvoiceInput {
  readonly dueAt: string;
  readonly id: string;
  readonly invoiceNumber: number;
  readonly paidCents: number;
  readonly settledAt?: string;
  readonly status: InvoiceFollowUpStatus;
  readonly tenantId: string;
  readonly totalCents: number;
}

export interface FollowUpContactPolicy {
  readonly customerEmail: string | null;
  readonly customerFirstName?: string;
  readonly emailSuppressed: boolean;
  readonly marketingEmailOptedIn: boolean;
  readonly transactionalEmailAllowed: boolean;
}

export interface FollowUpPolicyInput {
  readonly businessTimeZone: string;
  readonly contact: FollowUpContactPolicy;
  readonly evaluatedAt: string;
  readonly invoice: FollowUpInvoiceInput;
  readonly paymentStateSource: PaymentStateSource;
  readonly priorMessageKeys: readonly string[];
  readonly tenantId: string;
}

export type FollowUpMessageKind =
  'overdue_3_day' | 'overdue_7_day' | 'overdue_14_day' | 'review_request';

export interface FollowUpMessageProposal {
  readonly body: string;
  readonly category: 'marketing' | 'transactional';
  readonly dedupeKey: string;
  readonly invoiceId: string;
  readonly kind: FollowUpMessageKind;
  readonly paymentStateSource: PaymentStateSource;
  readonly subject: string;
  readonly to: string;
}

export type FollowUpPolicyResult =
  | {
      readonly escalationReason: string;
      readonly status: 'escalated';
    }
  | {
      readonly reason: string;
      readonly status: 'no_action';
    }
  | {
      readonly exactChanges: {
        readonly message: {
          readonly from: null;
          readonly to: FollowUpMessageProposal;
        };
      };
      readonly rationale: readonly string[];
      readonly requiresHumanApproval: true;
      readonly status: 'proposed';
    };

const DAY_MS = 86_400_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REMINDER_DAYS = new Set([3, 7, 14]);

function safeName(value: string | undefined): string {
  if (!value) return 'there';
  const normalized = [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 32 && codePoint !== 127;
    })
    .join('')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 100);
  return normalized || 'there';
}

function localDayNumber(value: string, timeZone: string): number | undefined {
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return undefined;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      month: '2-digit',
      timeZone,
      year: 'numeric',
    }).formatToParts(new Date(instant));
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((item) => item.type === type)?.value);
    const year = part('year');
    const month = part('month');
    const day = part('day');
    if (![year, month, day].every(Number.isInteger)) return undefined;
    return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
  } catch {
    return undefined;
  }
}

function validMoney(invoice: FollowUpInvoiceInput): boolean {
  return (
    Number.isSafeInteger(invoice.invoiceNumber) &&
    invoice.invoiceNumber > 0 &&
    Number.isSafeInteger(invoice.totalCents) &&
    invoice.totalCents >= 0 &&
    Number.isSafeInteger(invoice.paidCents) &&
    invoice.paidCents >= 0 &&
    invoice.paidCents <= invoice.totalCents
  );
}

function canEmail(
  contact: FollowUpContactPolicy,
  category: 'marketing' | 'transactional',
): boolean {
  if (
    contact.emailSuppressed ||
    !contact.customerEmail ||
    !EMAIL_PATTERN.test(contact.customerEmail) ||
    !contact.transactionalEmailAllowed
  ) {
    return false;
  }
  return category === 'transactional' || contact.marketingEmailOptedIn;
}

function dollars(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    style: 'currency',
  }).format(cents / 100);
}

function proposed(
  input: FollowUpPolicyInput,
  message: FollowUpMessageProposal,
  rationale: readonly string[],
): FollowUpPolicyResult {
  if (input.priorMessageKeys.includes(message.dedupeKey)) {
    return {
      reason:
        'This follow-up milestone already has a queued or delivered message.',
      status: 'no_action',
    };
  }
  return {
    exactChanges: { message: { from: null, to: message } },
    rationale,
    requiresHumanApproval: true,
    status: 'proposed',
  };
}

export function proposeInvoiceFollowUp(
  input: FollowUpPolicyInput,
): FollowUpPolicyResult {
  if (input.invoice.tenantId !== input.tenantId) {
    return {
      escalationReason: 'Invoice data belongs to a different workspace.',
      status: 'escalated',
    };
  }
  if (!validMoney(input.invoice)) {
    return {
      escalationReason: 'Invoice amount or number data is invalid.',
      status: 'escalated',
    };
  }

  const evaluatedDay = localDayNumber(
    input.evaluatedAt,
    input.businessTimeZone,
  );
  const dueDay = localDayNumber(input.invoice.dueAt, input.businessTimeZone);
  if (evaluatedDay === undefined || dueDay === undefined) {
    return {
      escalationReason:
        'Evaluation time, due time, or business time zone is invalid.',
      status: 'escalated',
    };
  }

  if (input.invoice.status === 'void') {
    return {
      reason: 'Void invoices never receive follow-ups.',
      status: 'no_action',
    };
  }

  const name = safeName(input.contact.customerFirstName);
  const email = input.contact.customerEmail;
  if (input.invoice.status === 'paid') {
    if (input.invoice.paidCents !== input.invoice.totalCents) {
      return {
        escalationReason:
          'Paid invoice status does not match its recorded balance.',
        status: 'escalated',
      };
    }
    if (!input.invoice.settledAt) {
      return {
        escalationReason:
          'Paid invoice is missing its recorded settlement time.',
        status: 'escalated',
      };
    }
    const settledDay = localDayNumber(
      input.invoice.settledAt,
      input.businessTimeZone,
    );
    if (settledDay === undefined) {
      return {
        escalationReason: 'Recorded settlement time is invalid.',
        status: 'escalated',
      };
    }
    if (evaluatedDay - settledDay !== 2) {
      return {
        reason: 'The optional review-request milestone is not due today.',
        status: 'no_action',
      };
    }
    if (!canEmail(input.contact, 'marketing') || !email) {
      return {
        reason: 'Review requests require a deliverable opted-in email contact.',
        status: 'no_action',
      };
    }

    return proposed(
      input,
      {
        body: `Hi ${name}, thank you for your payment on invoice #${input.invoice.invoiceNumber}. If you have a moment, we would appreciate your feedback about the service you received.`,
        category: 'marketing',
        dedupeKey: `invoice:${input.invoice.id}:review_request`,
        invoiceId: input.invoice.id,
        kind: 'review_request',
        paymentStateSource: input.paymentStateSource,
        subject: 'How was your service experience?',
        to: email,
      },
      [
        'The invoice is recorded as fully paid.',
        'Two business-local calendar days have passed since settlement.',
        'The customer is eligible for optional marketing email.',
      ],
    );
  }

  if (!['sent', 'partially_paid'].includes(input.invoice.status)) {
    return {
      reason:
        'Only sent or partially paid invoices can receive payment reminders.',
      status: 'no_action',
    };
  }
  if (input.invoice.paidCents === input.invoice.totalCents) {
    return {
      reason: 'The invoice balance is fully recorded; no reminder is allowed.',
      status: 'no_action',
    };
  }

  const daysOverdue = evaluatedDay - dueDay;
  if (!REMINDER_DAYS.has(daysOverdue)) {
    return {
      reason: 'No configured 3, 7, or 14-day overdue milestone is due today.',
      status: 'no_action',
    };
  }
  if (!canEmail(input.contact, 'transactional') || !email) {
    return {
      reason:
        'Payment reminders require a deliverable transactional email contact.',
      status: 'no_action',
    };
  }

  const outstanding = input.invoice.totalCents - input.invoice.paidCents;
  const kind = `overdue_${daysOverdue}_day` as FollowUpMessageKind;
  const bodies: Record<3 | 7 | 14, string> = {
    3: `Hi ${name}, this is a friendly reminder that invoice #${input.invoice.invoiceNumber} has an outstanding balance of ${dollars(outstanding)}. If payment is already in progress, please disregard this message.`,
    7: `Hi ${name}, invoice #${input.invoice.invoiceNumber} remains unpaid with ${dollars(outstanding)} outstanding. Please review the invoice or contact the service business if you need assistance.`,
    14: `Hi ${name}, invoice #${input.invoice.invoiceNumber} is now 14 days overdue with ${dollars(outstanding)} outstanding. Please arrange payment or contact the service business promptly to discuss the account.`,
  };

  return proposed(
    input,
    {
      body: bodies[daysOverdue as 3 | 7 | 14],
      category: 'transactional',
      dedupeKey: `invoice:${input.invoice.id}:overdue:${daysOverdue}`,
      invoiceId: input.invoice.id,
      kind,
      paymentStateSource: input.paymentStateSource,
      subject: `Invoice #${input.invoice.invoiceNumber} payment reminder`,
      to: email,
    },
    [
      `The invoice reached the ${daysOverdue}-day overdue milestone in the business time zone.`,
      'The invoice is sent or partially paid and still has an outstanding balance.',
      `The displayed payment state source is ${input.paymentStateSource}.`,
    ],
  );
}
