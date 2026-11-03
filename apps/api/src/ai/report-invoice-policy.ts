export interface InvoiceLineInput {
  readonly description: string;
  readonly quantity: number;
  readonly taxable: boolean;
  readonly unitPriceCents: number;
}

export interface AcceptedQuoteInput {
  readonly discountCents: number;
  readonly id: string;
  readonly lines: readonly InvoiceLineInput[];
  readonly status: string;
  readonly tenantId: string;
}

export interface CatalogServiceInput {
  readonly id: string;
  readonly name: string;
  readonly taxBehavior: 'exclusive' | 'inclusive' | 'non_taxable';
  readonly tenantId: string;
  readonly unitPriceCents: number;
}

export interface ReportInvoicePolicyInput {
  readonly acceptedQuote?: AcceptedQuoteInput;
  readonly catalogService?: CatalogServiceInput;
  readonly hasActiveInvoice: boolean;
  readonly jobId: string;
  readonly jobStatus: string;
  readonly requestedAt: string;
  readonly taxRateBps: number;
  readonly tenantId: string;
}

export interface InvoiceDraftProposal {
  readonly discountCents: number;
  readonly dueAt: string;
  readonly lineItems: readonly InvoiceLineInput[];
  readonly paymentUrl: null;
  readonly subtotalCents: number;
  readonly taxCents: number;
  readonly taxRateBps: number;
  readonly totalCents: number;
}

export type ReportInvoicePolicyResult =
  | {
      readonly escalationReason: string;
      readonly status: 'escalated';
    }
  | {
      readonly reason: string;
      readonly status: 'unchanged';
    }
  | {
      readonly draft: InvoiceDraftProposal;
      readonly exactChanges: {
        readonly discountCents: { readonly from: null; readonly to: number };
        readonly dueAt: { readonly from: null; readonly to: string };
        readonly lineItems: {
          readonly from: null;
          readonly to: readonly InvoiceLineInput[];
        };
        readonly paymentUrl: { readonly from: null; readonly to: null };
      };
      readonly rationale: readonly string[];
      readonly requiresHumanApproval: true;
      readonly source: 'accepted_quote' | 'catalog_service';
      readonly sourceId: string;
      readonly status: 'proposed';
    };

const MAX_DESCRIPTION_LENGTH = 240;
const MAX_LINE_ITEMS = 50;
const MAX_QUANTITY = 999;
const MAX_UNIT_PRICE_CENTS = 100_000_000;
const DUE_DAYS = 14;

function normalizedText(value: string): string {
  return [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 32 && codePoint !== 127;
    })
    .join('')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizedLines(
  lines: readonly InvoiceLineInput[],
): readonly InvoiceLineInput[] | undefined {
  if (lines.length < 1 || lines.length > MAX_LINE_ITEMS) return undefined;

  const normalized = lines.map((line) => ({
    description: normalizedText(line.description),
    quantity: line.quantity,
    taxable: line.taxable,
    unitPriceCents: line.unitPriceCents,
  }));
  if (
    normalized.some(
      (line) =>
        line.description.length < 1 ||
        line.description.length > MAX_DESCRIPTION_LENGTH ||
        !Number.isSafeInteger(line.quantity) ||
        line.quantity < 1 ||
        line.quantity > MAX_QUANTITY ||
        !Number.isSafeInteger(line.unitPriceCents) ||
        line.unitPriceCents < 0 ||
        line.unitPriceCents > MAX_UNIT_PRICE_CENTS,
    )
  ) {
    return undefined;
  }
  return normalized;
}

function calculateDraft(
  lines: readonly InvoiceLineInput[],
  discountCents: number,
  taxRateBps: number,
  requestedAt: number,
): InvoiceDraftProposal | undefined {
  const subtotalCents = lines.reduce(
    (sum, line) => sum + line.quantity * line.unitPriceCents,
    0,
  );
  const taxableSubtotal = lines.reduce(
    (sum, line) =>
      sum + (line.taxable ? line.quantity * line.unitPriceCents : 0),
    0,
  );
  if (
    !Number.isSafeInteger(subtotalCents) ||
    !Number.isSafeInteger(taxableSubtotal) ||
    !Number.isSafeInteger(discountCents) ||
    discountCents < 0 ||
    discountCents > subtotalCents ||
    !Number.isInteger(taxRateBps) ||
    taxRateBps < 0 ||
    taxRateBps > 10_000
  ) {
    return undefined;
  }

  const taxableDiscount =
    subtotalCents === 0
      ? 0
      : Math.round((discountCents * taxableSubtotal) / subtotalCents);
  const taxCents = Math.round(
    (Math.max(taxableSubtotal - taxableDiscount, 0) * taxRateBps) / 10_000,
  );
  const totalCents = subtotalCents - discountCents + taxCents;
  if (!Number.isSafeInteger(taxCents) || !Number.isSafeInteger(totalCents)) {
    return undefined;
  }

  return {
    discountCents,
    dueAt: new Date(requestedAt + DUE_DAYS * 86_400_000).toISOString(),
    lineItems: lines,
    paymentUrl: null,
    subtotalCents,
    taxCents,
    taxRateBps,
    totalCents,
  };
}

export function proposeReportInvoice(
  input: ReportInvoicePolicyInput,
): ReportInvoicePolicyResult {
  if (!['completed', 'closed'].includes(input.jobStatus)) {
    return {
      escalationReason:
        'Only completed or closed jobs can produce an invoice draft.',
      status: 'escalated',
    };
  }
  if (input.hasActiveInvoice) {
    return {
      reason:
        'The job already has an active invoice; no duplicate was proposed.',
      status: 'unchanged',
    };
  }

  const requestedAt = Date.parse(input.requestedAt);
  if (!Number.isFinite(requestedAt)) {
    return {
      escalationReason: 'Invoice request time is invalid.',
      status: 'escalated',
    };
  }

  if (
    (input.acceptedQuote !== undefined &&
      input.acceptedQuote.tenantId !== input.tenantId) ||
    (input.catalogService !== undefined &&
      input.catalogService.tenantId !== input.tenantId)
  ) {
    return {
      escalationReason:
        'Invoice input contained pricing from a different workspace.',
      status: 'escalated',
    };
  }

  let lines: readonly InvoiceLineInput[] | undefined;
  let discountCents = 0;
  let source: 'accepted_quote' | 'catalog_service';
  let sourceId: string;
  if (input.acceptedQuote) {
    if (input.acceptedQuote.status !== 'accepted') {
      return {
        escalationReason: 'The supplied quote is not accepted.',
        status: 'escalated',
      };
    }
    lines = normalizedLines(input.acceptedQuote.lines);
    discountCents = input.acceptedQuote.discountCents;
    source = 'accepted_quote';
    sourceId = input.acceptedQuote.id;
  } else if (input.catalogService) {
    lines = normalizedLines([
      {
        description: input.catalogService.name,
        quantity: 1,
        taxable: input.catalogService.taxBehavior !== 'non_taxable',
        unitPriceCents: input.catalogService.unitPriceCents,
      },
    ]);
    source = 'catalog_service';
    sourceId = input.catalogService.id;
  } else {
    return {
      escalationReason:
        'No accepted quote or catalog service price was available.',
      status: 'escalated',
    };
  }

  if (!lines) {
    return {
      escalationReason: 'Trusted invoice line items are invalid.',
      status: 'escalated',
    };
  }
  const draft = calculateDraft(
    lines,
    discountCents,
    input.taxRateBps,
    requestedAt,
  );
  if (!draft) {
    return {
      escalationReason: 'Invoice totals or tax inputs are invalid.',
      status: 'escalated',
    };
  }

  return {
    draft,
    exactChanges: {
      discountCents: { from: null, to: draft.discountCents },
      dueAt: { from: null, to: draft.dueAt },
      lineItems: { from: null, to: draft.lineItems },
      paymentUrl: { from: null, to: null },
    },
    rationale: [
      source === 'accepted_quote'
        ? 'Line items and discount came from the latest accepted quote.'
        : 'One line item came from the tenant service catalog.',
      `Tax used the tenant rate of ${input.taxRateBps} basis points.`,
      'No technician note, photo, part, recommendation, or prompt text was converted into a charge.',
      'No payment link was inferred. Office approval is required before saving this editable draft.',
    ],
    requiresHumanApproval: true,
    source,
    sourceId,
    status: 'proposed',
  };
}
