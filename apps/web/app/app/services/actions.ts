'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { createClient } from '../../../lib/supabase/server';

export interface ServiceFormState {
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  readonly message?: string;
  readonly status: 'idle' | 'error' | 'success';
}

const serviceSchema = z.object({
  defaultDurationMinutes: z.coerce
    .number()
    .int('Duration must be a whole number.')
    .min(5, 'Duration must be at least 5 minutes.')
    .max(1440, 'Duration cannot exceed 24 hours.'),
  description: z.string().trim().max(2000).default(''),
  name: z.string().trim().min(2, 'Enter a service name.').max(120),
  taxBehavior: z.enum(['exclusive', 'inclusive', 'non_taxable']),
  unitPrice: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, 'Enter a valid amount with up to 2 decimals.')
    .refine(
      (value) => Number(value) <= 21_474_836.47,
      'Price is above the supported maximum.',
    ),
});

const serviceIdSchema = z.uuid();

function readService(formData: FormData) {
  return serviceSchema.safeParse({
    defaultDurationMinutes: formData.get('defaultDurationMinutes'),
    description: formData.get('description'),
    name: formData.get('name'),
    taxBehavior: formData.get('taxBehavior'),
    unitPrice: formData.get('unitPrice'),
  });
}

function toCents(value: string): number {
  const [dollars, fraction = ''] = value.split('.');
  return Number(dollars) * 100 + Number(fraction.padEnd(2, '0'));
}

function validationFailure(error: z.ZodError): ServiceFormState {
  return {
    fieldErrors: error.flatten().fieldErrors,
    message: 'Please correct the highlighted fields.',
    status: 'error',
  };
}

export async function createServiceAction(
  _previousState: ServiceFormState,
  formData: FormData,
): Promise<ServiceFormState> {
  const parsed = readService(formData);
  if (!parsed.success) return validationFailure(parsed.error);

  const context = await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('services')
    .insert({
      default_duration_minutes: parsed.data.defaultDurationMinutes,
      description: parsed.data.description || null,
      is_enabled: formData.get('isEnabled') === 'on',
      name: parsed.data.name,
      tax_behavior: parsed.data.taxBehavior,
      tenant_id: context.tenantId,
      unit_price_cents: toCents(parsed.data.unitPrice),
    })
    .select('id')
    .single();

  if (error) {
    return {
      message:
        error.code === '23505'
          ? 'A service with this name already exists.'
          : 'Service could not be saved. Please try again.',
      status: 'error',
    };
  }

  revalidatePath('/app/services');
  redirect(`/app/services/${data.id}`);
}

export async function updateServiceAction(
  _previousState: ServiceFormState,
  formData: FormData,
): Promise<ServiceFormState> {
  const serviceId = serviceIdSchema.safeParse(formData.get('serviceId'));
  const parsed = readService(formData);
  if (!serviceId.success || !parsed.success) {
    return !parsed.success
      ? validationFailure(parsed.error)
      : { message: 'Invalid service.', status: 'error' };
  }

  const context = await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('services')
    .update({
      default_duration_minutes: parsed.data.defaultDurationMinutes,
      description: parsed.data.description || null,
      is_enabled: formData.get('isEnabled') === 'on',
      name: parsed.data.name,
      tax_behavior: parsed.data.taxBehavior,
      unit_price_cents: toCents(parsed.data.unitPrice),
    })
    .eq('id', serviceId.data)
    .eq('tenant_id', context.tenantId)
    .is('archived_at', null)
    .select('id')
    .maybeSingle();

  if (error || !data) {
    return {
      message:
        error?.code === '23505'
          ? 'A service with this name already exists.'
          : 'Service could not be updated.',
      status: 'error',
    };
  }

  revalidatePath('/app/services');
  revalidatePath(`/app/services/${serviceId.data}`);
  return { message: 'Service updated.', status: 'success' };
}

export async function archiveServiceAction(formData: FormData): Promise<void> {
  const serviceId = serviceIdSchema.safeParse(formData.get('serviceId'));
  if (!serviceId.success) return;

  const context = await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const { error } = await supabase
    .from('services')
    .update({ archived_at: new Date().toISOString(), is_enabled: false })
    .eq('id', serviceId.data)
    .eq('tenant_id', context.tenantId)
    .is('archived_at', null);

  if (error) throw new Error('Service could not be archived.');
  revalidatePath('/app/services');
  redirect('/app/services');
}
