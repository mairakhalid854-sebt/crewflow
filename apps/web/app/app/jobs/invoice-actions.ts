'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { appUrl } from '../../../lib/app-url';
import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { localDateTimeToIso } from '../../../lib/date-time';
import { requestLinkEmail } from '../../../lib/email/link-email';
import { normalizeExternalPaymentUrl } from '../../../lib/invoices/public-invoice';
import { createClient } from '../../../lib/supabase/server';

export interface InvoiceActionState {
  readonly message?: string;
  readonly shareUrl?: string;
  readonly status: 'idle' | 'error' | 'success';
}

interface InvoiceProposalResult {
  readonly proposal_result: 'escalated' | 'proposed' | 'unchanged';
  readonly provider_reviewed: boolean;
  readonly result_message?: string;
}

function parseInvoiceProposalResult(
  value: unknown,
): InvoiceProposalResult | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    !['escalated', 'proposed', 'unchanged'].includes(
      String(candidate.proposal_result),
    ) ||
    typeof candidate.provider_reviewed !== 'boolean' ||
    (candidate.result_message !== undefined &&
      typeof candidate.result_message !== 'string')
  ) {
    return undefined;
  }
  return candidate as unknown as InvoiceProposalResult;
}

const headerSchema = z.object({
  discount: z
    .string()
    .trim()
    .regex(/^\d{1,7}(?:\.\d{1,2})?$/, 'Enter a valid discount amount.'),
  dueOn: z.iso.date('Enter a valid due date.'),
  jobId: z.uuid(),
  paymentUrl: z.string().trim().max(2048),
});

const itemSchema = z.object({
  description: z.string().trim().min(1).max(240),
  quantity: z.coerce.number().int().min(1).max(999),
  taxable: z.boolean(),
  unitPrice: z
    .string()
    .trim()
    .regex(/^\d{1,7}(?:\.\d{1,2})?$/, 'Enter a valid unit price.')
    .refine(
      (value) => dollarsToCents(value) <= 100_000_000,
      'Unit price cannot exceed $1,000,000.',
    ),
});

function dollarsToCents(value: string): number {
  const negative = value.startsWith('-');
  const normalized = negative ? value.slice(1) : value;
  const [whole = '0', fraction = ''] = normalized.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return negative ? -cents : cents;
}

function invoiceError(message?: string): string {
  const normalized = message?.toLowerCase() ?? '';
  if (normalized.includes('payment url')) {
    return 'Payment link must use HTTPS and a public domain name.';
  }
  if (normalized.includes('due date')) {
    return 'Due date must be within the next 365 days.';
  }
  if (normalized.includes('discount')) {
    return 'Discount cannot exceed the invoice subtotal.';
  }
  if (normalized.includes('outstanding')) {
    return 'Amount cannot exceed the outstanding invoice balance.';
  }
  if (normalized.includes('active invoice')) {
    return 'This job already has an active invoice.';
  }
  return 'Invoice could not be updated. Please try again.';
}

export async function requestAiInvoiceProposalAction(
  _previous: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  await requireTenantContext(['owner', 'office']);
  const parsedJobId = z.uuid().safeParse(formData.get('jobId'));
  if (!parsedJobId.success) {
    return { message: 'Job could not be identified.', status: 'error' };
  }

  const supabase = await createClient();
  const correlationId = crypto.randomUUID();
  const invocation: unknown = await supabase.functions.invoke(
    'report-openai-proposal',
    {
      body: {
        correlationId,
        jobId: parsedJobId.data,
        proposalType: 'invoice',
      },
    },
  );
  const invoked = invocation as
    { data?: unknown; error?: unknown } | null | undefined;
  let result = invoked?.error
    ? undefined
    : parseInvoiceProposalResult(invoked?.data);
  let fallbackError: { message: string } | null = null;

  if (!result) {
    const fallback = await supabase.rpc('request_report_invoice_proposal', {
      target_correlation_id: correlationId,
      target_job_id: parsedJobId.data,
    });
    fallbackError = fallback.error;
    if (fallback.data?.[0]) {
      result = parseInvoiceProposalResult({
        ...fallback.data[0],
        provider_reviewed: false,
      });
    }
  }

  if (fallbackError || !result) {
    return {
      message:
        'AI invoice evaluation could not finish. Check AI settings, trusted pricing, job status, and subscription access.',
      status: 'error',
    };
  }

  revalidatePath('/app/ai');
  revalidatePath(`/app/jobs/${parsedJobId.data}`);
  return {
    message:
      result.proposal_result === 'proposed'
        ? result.provider_reviewed
          ? 'Invoice proposal and bounded AI review recorded. Review it in AI Operations before approving.'
          : 'Invoice proposal created from trusted pricing. AI review was unavailable, so the deterministic proposal was kept.'
        : result.proposal_result === 'unchanged'
          ? 'This job already has an active invoice.'
          : result.provider_reviewed
            ? 'Invoice drafting needs human input. The AI-reviewed escalation is recorded in AI Operations.'
            : (result.result_message ??
              'Invoice drafting needs human input. Review the trace in AI Operations.'),
    status: result.proposal_result === 'escalated' ? 'error' : 'success',
  };
}

export async function saveInvoiceAction(
  _previous: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const header = headerSchema.safeParse({
    discount: formData.get('discount'),
    dueOn: formData.get('dueOn'),
    jobId: formData.get('jobId'),
    paymentUrl: formData.get('paymentUrl'),
  });
  if (!header.success) {
    return { message: 'Please correct the invoice fields.', status: 'error' };
  }

  const paymentUrl = header.data.paymentUrl
    ? normalizeExternalPaymentUrl(header.data.paymentUrl)
    : null;
  if (header.data.paymentUrl && !paymentUrl) {
    return {
      message: 'Payment link must use HTTPS and a public domain name.',
      status: 'error',
    };
  }

  const descriptions = formData.getAll('description');
  const quantities = formData.getAll('quantity');
  const unitPrices = formData.getAll('unitPrice');
  if (
    descriptions.length === 0 ||
    descriptions.length > 50 ||
    descriptions.length !== quantities.length ||
    descriptions.length !== unitPrices.length
  ) {
    return { message: 'Add at least one valid line item.', status: 'error' };
  }

  const parsedItems = descriptions.map((description, index) =>
    itemSchema.safeParse({
      description,
      quantity: quantities[index],
      taxable: formData.get(`taxable-${index}`) === 'on',
      unitPrice: unitPrices[index],
    }),
  );
  const invalid = parsedItems.find((item) => !item.success);
  if (invalid && !invalid.success) {
    return {
      message: invalid.error.issues[0]?.message ?? 'Invalid invoice item.',
      status: 'error',
    };
  }

  const context = await requireTenantContext(['owner', 'office']);
  const dueAt = localDateTimeToIso(
    `${header.data.dueOn}T23:59`,
    context.timeZone,
  );
  if (!dueAt) return { message: 'Enter a valid due date.', status: 'error' };

  const items = parsedItems.map((item) => {
    if (!item.success) throw new Error('Validated invoice item expected.');
    return {
      description: item.data.description,
      quantity: item.data.quantity,
      taxable: item.data.taxable,
      unit_price_cents: dollarsToCents(item.data.unitPrice),
    };
  });

  const supabase = await createClient();
  const { error } = await supabase.rpc('save_job_invoice', {
    invoice_discount_cents: dollarsToCents(header.data.discount),
    invoice_due_at: dueAt,
    invoice_items: items,
    invoice_payment_url: paymentUrl ?? '',
    target_job_id: header.data.jobId,
  });
  if (error) return { message: invoiceError(error.message), status: 'error' };

  revalidatePath('/app');
  revalidatePath('/app/invoices');
  revalidatePath(`/app/jobs/${header.data.jobId}`);
  return { message: 'Draft invoice saved.', status: 'success' };
}

export async function publishInvoiceAction(
  _previous: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const parsed = z.object({ invoiceId: z.uuid(), jobId: z.uuid() }).safeParse({
    invoiceId: formData.get('invoiceId'),
    jobId: formData.get('jobId'),
  });
  if (!parsed.success) return { message: 'Invalid invoice.', status: 'error' };

  await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const { data: token, error } = await supabase.rpc('publish_job_invoice', {
    target_invoice_id: parsed.data.invoiceId,
  });
  if (error) return { message: invoiceError(error.message), status: 'error' };

  const emailMessage =
    formData.get('emailLink') === 'on'
      ? ` ${await requestLinkEmail(supabase, 'invoice', parsed.data.invoiceId, token)}`
      : '';

  revalidatePath('/app/invoices');
  revalidatePath(`/app/jobs/${parsed.data.jobId}`);
  return {
    message: `Invoice sent state recorded. Copy this secure link now.${emailMessage}`,
    shareUrl: `${appUrl()}/invoice/${token}`,
    status: 'success',
  };
}

export async function recordPaymentAction(
  _previous: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const parsed = z
    .object({
      amount: z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/),
      invoiceId: z.uuid(),
      jobId: z.uuid(),
      method: z.enum(['cash', 'check', 'external_transfer', 'other']),
      note: z.string().trim().max(500),
      receivedAt: z.string().min(1),
      reference: z.string().trim().max(160),
    })
    .safeParse({
      amount: formData.get('amount'),
      invoiceId: formData.get('invoiceId'),
      jobId: formData.get('jobId'),
      method: formData.get('method'),
      note: formData.get('note'),
      receivedAt: formData.get('receivedAt'),
      reference: formData.get('reference'),
    });
  if (!parsed.success) {
    return { message: 'Enter valid payment details.', status: 'error' };
  }

  const context = await requireTenantContext(['owner', 'office']);
  const receivedAt = localDateTimeToIso(
    parsed.data.receivedAt,
    context.timeZone,
  );
  if (!receivedAt) {
    return { message: 'Enter a valid received time.', status: 'error' };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('record_manual_invoice_payment', {
    payment_amount_cents: dollarsToCents(parsed.data.amount),
    payment_method: parsed.data.method,
    payment_note: parsed.data.note,
    payment_received_at: receivedAt,
    payment_reference: parsed.data.reference,
    target_invoice_id: parsed.data.invoiceId,
  });
  if (error) return { message: invoiceError(error.message), status: 'error' };

  revalidatePath('/app');
  revalidatePath('/app/invoices');
  revalidatePath(`/app/jobs/${parsed.data.jobId}`);
  return {
    message: 'Manual payment recorded. No funds moved through CrewFlow.',
    status: 'success',
  };
}

export async function recordAdjustmentAction(
  _previous: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const parsed = z
    .object({
      amount: z.string().regex(/^-?\d{1,10}(?:\.\d{1,2})?$/),
      invoiceId: z.uuid(),
      jobId: z.uuid(),
      reason: z.string().trim().min(3).max(500),
    })
    .safeParse({
      amount: formData.get('amount'),
      invoiceId: formData.get('invoiceId'),
      jobId: formData.get('jobId'),
      reason: formData.get('reason'),
    });
  if (!parsed.success || dollarsToCents(parsed.data.amount) === 0) {
    return {
      message: 'Enter a non-zero adjustment and reason.',
      status: 'error',
    };
  }

  await requireTenantContext(['owner']);
  const supabase = await createClient();
  const { error } = await supabase.rpc('record_invoice_adjustment', {
    adjustment_amount_cents: dollarsToCents(parsed.data.amount),
    adjustment_reason: parsed.data.reason,
    target_invoice_id: parsed.data.invoiceId,
  });
  if (error) return { message: invoiceError(error.message), status: 'error' };

  revalidatePath('/app');
  revalidatePath('/app/invoices');
  revalidatePath(`/app/jobs/${parsed.data.jobId}`);
  return { message: 'Ledger adjustment recorded.', status: 'success' };
}

export async function voidInvoiceAction(
  _previous: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const parsed = z
    .object({
      invoiceId: z.uuid(),
      jobId: z.uuid(),
      reason: z.string().trim().min(3).max(500),
    })
    .safeParse({
      invoiceId: formData.get('invoiceId'),
      jobId: formData.get('jobId'),
      reason: formData.get('reason'),
    });
  if (!parsed.success) {
    return { message: 'A void reason is required.', status: 'error' };
  }

  await requireTenantContext(['owner']);
  const supabase = await createClient();
  const { error } = await supabase.rpc('void_invoice', {
    reason: parsed.data.reason,
    target_invoice_id: parsed.data.invoiceId,
  });
  if (error) return { message: invoiceError(error.message), status: 'error' };

  revalidatePath('/app');
  revalidatePath('/app/invoices');
  revalidatePath(`/app/jobs/${parsed.data.jobId}`);
  return {
    message: 'Invoice voided; history was retained.',
    status: 'success',
  };
}
