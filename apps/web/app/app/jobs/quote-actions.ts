'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { appUrl } from '../../../lib/app-url';
import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { localDateTimeToIso } from '../../../lib/date-time';
import { requestLinkEmail } from '../../../lib/email/link-email';
import { createClient } from '../../../lib/supabase/server';

export interface QuoteFormState {
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  readonly message?: string;
  readonly quoteId?: string;
  readonly shareUrl?: string;
  readonly status: 'idle' | 'error' | 'success';
}

const quoteHeaderSchema = z.object({
  discount: z
    .string()
    .trim()
    .regex(/^\d{1,7}(?:\.\d{1,2})?$/, 'Enter a valid discount amount.'),
  expiresOn: z.iso.date('Enter a valid expiration date.'),
  jobId: z.uuid('Invalid job.'),
});

const lineItemSchema = z.object({
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
  const [whole = '0', fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

function databaseMessage(detail?: string): string {
  const normalized = detail?.toLowerCase() ?? '';
  if (normalized.includes('expiration')) {
    return 'Expiration must be within the next 180 days.';
  }
  if (normalized.includes('discount')) {
    return 'Discount cannot be greater than the quote subtotal.';
  }
  if (normalized.includes('line item')) {
    return 'One or more quote line items are invalid.';
  }
  if (normalized.includes('no longer available')) {
    return 'This job is no longer available for quoting.';
  }
  return 'Quote could not be saved. Please try again.';
}

export async function saveQuoteAction(
  _previousState: QuoteFormState,
  formData: FormData,
): Promise<QuoteFormState> {
  const header = quoteHeaderSchema.safeParse({
    discount: formData.get('discount'),
    expiresOn: formData.get('expiresOn'),
    jobId: formData.get('jobId'),
  });
  if (!header.success) {
    return {
      fieldErrors: header.error.flatten().fieldErrors,
      message: 'Please correct the highlighted fields.',
      status: 'error',
    };
  }

  const descriptions = formData.getAll('description');
  const quantities = formData.getAll('quantity');
  const unitPrices = formData.getAll('unitPrice');
  if (
    descriptions.length === 0 ||
    descriptions.length > 50 ||
    quantities.length !== descriptions.length ||
    unitPrices.length !== descriptions.length
  ) {
    return { message: 'Add at least one valid line item.', status: 'error' };
  }

  const items = descriptions.map((description, index) =>
    lineItemSchema.safeParse({
      description,
      quantity: quantities[index],
      taxable: formData.get(`taxable-${index}`) === 'on',
      unitPrice: unitPrices[index],
    }),
  );
  const invalidItem = items.find((item) => !item.success);
  if (invalidItem && !invalidItem.success) {
    return {
      message: invalidItem.error.issues[0]?.message ?? 'Invalid line item.',
      status: 'error',
    };
  }

  const context = await requireTenantContext(['owner', 'office']);
  const expiresAt = localDateTimeToIso(
    `${header.data.expiresOn}T23:59`,
    context.timeZone,
  );
  if (!expiresAt) {
    return { message: 'Enter a valid expiration date.', status: 'error' };
  }

  const quoteItems = items.map((item) => {
    if (!item.success) throw new Error('Validated quote item expected.');
    return {
      description: item.data.description,
      quantity: item.data.quantity,
      taxable: item.data.taxable,
      unit_price_cents: dollarsToCents(item.data.unitPrice),
    };
  });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('save_job_quote', {
    quote_discount_cents: dollarsToCents(header.data.discount),
    quote_expires_at: expiresAt,
    quote_items: quoteItems,
    target_job_id: header.data.jobId,
  });
  if (error) {
    return { message: databaseMessage(error.message), status: 'error' };
  }

  revalidatePath(`/app/jobs/${header.data.jobId}`);
  revalidatePath(`/app/jobs/${header.data.jobId}/quote`);
  return {
    message: 'Draft quote saved. Review the totals before sending.',
    quoteId: data,
    status: 'success',
  };
}

export async function publishQuoteAction(
  _previousState: QuoteFormState,
  formData: FormData,
): Promise<QuoteFormState> {
  const parsed = z.object({ jobId: z.uuid(), quoteId: z.uuid() }).safeParse({
    jobId: formData.get('jobId'),
    quoteId: formData.get('quoteId'),
  });
  if (!parsed.success) {
    return { message: 'Invalid quote.', status: 'error' };
  }

  await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const { data: token, error } = await supabase.rpc('publish_job_quote', {
    target_quote_id: parsed.data.quoteId,
  });
  if (error) {
    return { message: databaseMessage(error.message), status: 'error' };
  }

  const emailMessage =
    formData.get('emailLink') === 'on'
      ? ` ${await requestLinkEmail(supabase, 'quote', parsed.data.quoteId, token)}`
      : '';

  revalidatePath('/app');
  revalidatePath('/app/jobs');
  revalidatePath(`/app/jobs/${parsed.data.jobId}`);
  return {
    message: `Quote sent state recorded. Copy this secure link now.${emailMessage}`,
    shareUrl: `${appUrl()}/quote/${token}`,
    status: 'success',
  };
}
