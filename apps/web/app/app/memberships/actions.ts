'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { createClient } from '../../../lib/supabase/server';

function field(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value : '';
}

export interface MembershipActionState {
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  readonly message?: string;
  readonly status: 'idle' | 'error' | 'success';
}

const planSchema = z.object({
  planId: z.union([z.literal(''), z.string().uuid()]),
  name: z.string().trim().min(2, 'Enter a plan name.').max(80),
  description: z
    .string()
    .trim()
    .max(600, 'Keep the description under 600 characters.'),
  price: z.coerce
    .number({ error: 'Enter a price.' })
    .min(0, 'The price cannot be negative.')
    .max(10000, 'Keep the price at $10,000 or less.')
    .multipleOf(0.01, 'Use no more than two decimal places.'),
  billingInterval: z.enum(['monthly', 'yearly']),
  visitsPerYear: z.coerce
    .number()
    .refine((value) => [1, 2, 3, 4, 6, 12].includes(value), {
      message: 'Choose 1, 2, 3, 4, 6, or 12 visits a year.',
    }),
  discountPercent: z.coerce
    .number({ error: 'Enter a discount.' })
    .int('Use a whole number.')
    .min(0, 'The discount cannot be negative.')
    .max(50, 'Keep the discount at 50% or less.'),
  serviceId: z.union([z.literal(''), z.string().uuid()]),
  isActive: z.boolean(),
});

export async function saveMembershipPlanAction(
  _previous: MembershipActionState,
  formData: FormData,
): Promise<MembershipActionState> {
  const context = await requireTenantContext(['owner']);
  const parsed = planSchema.safeParse({
    billingInterval: field(formData.get('billingInterval')),
    description: field(formData.get('description')),
    discountPercent: field(formData.get('discountPercent')),
    isActive: formData.get('isActive') === 'on',
    name: field(formData.get('name')),
    planId: field(formData.get('planId')),
    price: field(formData.get('price')),
    serviceId: field(formData.get('serviceId')),
    visitsPerYear: field(formData.get('visitsPerYear')),
  });
  if (!parsed.success) {
    return {
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
      message: 'Check the highlighted fields.',
      status: 'error',
    };
  }
  const values = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc('save_membership_plan', {
    target_billing_interval: values.billingInterval,
    target_description: values.description,
    target_discount_percent: values.discountPercent,
    target_is_active: values.isActive,
    target_name: values.name,
    target_plan_id: values.planId || null,
    target_price_cents: Math.round(values.price * 100),
    target_service_id: values.serviceId || null,
    target_tenant_id: context.tenantId,
    target_visits_per_year: values.visitsPerYear,
  });
  if (error) {
    const message = error.message.toLowerCase();
    return {
      fieldErrors: message.includes('membership_plans_name_unique')
        ? { name: ['You already have a plan with this name.'] }
        : undefined,
      message: message.includes('read-only')
        ? 'Choose a CrewFlow360 plan before creating membership plans.'
        : 'The plan could not be saved.',
      status: 'error',
    };
  }

  revalidatePath('/app/memberships');
  return { message: 'Plan saved.', status: 'success' };
}

const enrollSchema = z.object({
  customerId: z.string().uuid(),
  planId: z.string().uuid({ error: 'Choose a plan.' }),
  startedOn: z.iso.date({ error: 'Choose a start date.' }),
  firstVisitOn: z.iso.date({ error: 'Choose the first visit date.' }),
});

export async function enrollMembershipAction(
  _previous: MembershipActionState,
  formData: FormData,
): Promise<MembershipActionState> {
  await requireTenantContext(['owner', 'office']);
  const parsed = enrollSchema.safeParse({
    customerId: field(formData.get('customerId')),
    firstVisitOn: field(formData.get('firstVisitOn')),
    planId: field(formData.get('planId')),
    startedOn: field(formData.get('startedOn')),
  });
  if (!parsed.success) {
    return {
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
      message: 'Check the highlighted fields.',
      status: 'error',
    };
  }
  if (parsed.data.firstVisitOn < parsed.data.startedOn) {
    return {
      fieldErrors: {
        firstVisitOn: ['The first visit cannot be before the start date.'],
      },
      message: 'Check the highlighted fields.',
      status: 'error',
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('enroll_customer_membership', {
    target_customer_id: parsed.data.customerId,
    target_first_visit_on: parsed.data.firstVisitOn,
    target_plan_id: parsed.data.planId,
    target_started_on: parsed.data.startedOn,
  });
  if (error) {
    const message = error.message.toLowerCase();
    return {
      message: message.includes('already has this plan')
        ? 'This customer is already on that plan.'
        : message.includes('plan not available')
          ? 'That plan is turned off.'
          : 'The customer could not be enrolled.',
      status: 'error',
    };
  }

  revalidatePath(`/app/customers/${parsed.data.customerId}`);
  revalidatePath('/app/memberships');
  return { message: 'Customer enrolled.', status: 'success' };
}

export async function cancelMembershipAction(
  _previous: MembershipActionState,
  formData: FormData,
): Promise<MembershipActionState> {
  await requireTenantContext(['owner', 'office']);
  const membershipId = z
    .string()
    .uuid()
    .safeParse(formData.get('membershipId'));
  const reason = field(formData.get('reason')).trim();
  if (!membershipId.success) {
    return {
      message: 'This membership could not be cancelled.',
      status: 'error',
    };
  }
  if (reason.length < 3) {
    return {
      message: 'Enter a short reason (3+ characters).',
      status: 'error',
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('cancel_customer_membership', {
    target_membership_id: membershipId.data,
    target_reason: reason,
  });
  if (error) {
    return {
      message: 'This membership could not be cancelled.',
      status: 'error',
    };
  }

  revalidatePath('/app/memberships');
  revalidatePath('/app/customers', 'layout');
  return { message: 'Membership cancelled.', status: 'success' };
}

export async function createDueVisitsAction(): Promise<MembershipActionState> {
  const context = await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    'create_my_due_membership_visits',
    {
      target_tenant_id: context.tenantId,
    },
  );
  if (error) {
    return {
      message: 'Visits could not be created right now.',
      status: 'error',
    };
  }
  revalidatePath('/app/memberships');
  revalidatePath('/app/jobs');
  return {
    message:
      data === 0
        ? 'No visits are due in the next 14 days.'
        : `${data} visit job${data === 1 ? '' : 's'} created. Schedule them below or in Dispatch.`,
    status: 'success',
  };
}
