'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { createClient } from '../../../lib/supabase/server';

export interface CustomerFormState {
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  readonly message?: string;
  readonly status: 'idle' | 'error' | 'success';
}

const optionalEmail = z.union([
  z.literal(''),
  z.email('Enter a valid email address.').trim().toLowerCase(),
]);

const customerSchema = z.object({
  addressLine2: z.string().trim().max(120).default(''),
  city: z.string().trim().max(100).default(''),
  email: optionalEmail,
  firstName: z.string().trim().min(1, 'Enter a first name.').max(80),
  lastName: z.string().trim().min(1, 'Enter a last name.').max(80),
  notes: z.string().trim().max(2000).default(''),
  phone: z.string().trim().max(30).default(''),
  postalCode: z
    .string()
    .trim()
    .regex(/^$|^\d{5}(-\d{4})?$/, 'Use a valid US ZIP code.'),
  stateCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^$|^[A-Z]{2}$/, 'Use a two-letter state code.'),
  streetAddress: z.string().trim().max(180).default(''),
});

const customerIdSchema = z.uuid();

function nullable(value: string): string | null {
  return value === '' ? null : value;
}

function validationFailure(error: z.ZodError): CustomerFormState {
  return {
    fieldErrors: error.flatten().fieldErrors,
    message: 'Please correct the highlighted fields.',
    status: 'error',
  };
}

function readCustomer(formData: FormData) {
  return customerSchema.safeParse({
    addressLine2: formData.get('addressLine2'),
    city: formData.get('city'),
    email: formData.get('email'),
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    notes: formData.get('notes'),
    phone: formData.get('phone'),
    postalCode: formData.get('postalCode'),
    stateCode: formData.get('stateCode'),
    streetAddress: formData.get('streetAddress'),
  });
}

export async function createCustomerAction(
  _previousState: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const parsed = readCustomer(formData);
  if (!parsed.success) return validationFailure(parsed.error);

  const context = await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('customers')
    .insert({
      address_line_2: nullable(parsed.data.addressLine2),
      city: nullable(parsed.data.city),
      email: nullable(parsed.data.email),
      first_name: parsed.data.firstName,
      last_name: parsed.data.lastName,
      marketing_email_opted_in: formData.get('marketingEmailOptedIn') === 'on',
      notes: nullable(parsed.data.notes),
      phone: nullable(parsed.data.phone),
      postal_code: nullable(parsed.data.postalCode),
      state_code: nullable(parsed.data.stateCode),
      street_address: nullable(parsed.data.streetAddress),
      tenant_id: context.tenantId,
      transactional_email_allowed:
        formData.get('transactionalEmailAllowed') === 'on',
    })
    .select('id')
    .single();

  if (error) {
    return {
      message: 'Customer could not be saved. Please try again.',
      status: 'error',
    };
  }

  revalidatePath('/app/customers');
  redirect(`/app/customers/${data.id}`);
}

export async function updateCustomerAction(
  _previousState: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const customerId = customerIdSchema.safeParse(formData.get('customerId'));
  const parsed = readCustomer(formData);
  if (!customerId.success || !parsed.success) {
    return !parsed.success
      ? validationFailure(parsed.error)
      : { message: 'Invalid customer.', status: 'error' };
  }

  const context = await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('customers')
    .update({
      address_line_2: nullable(parsed.data.addressLine2),
      city: nullable(parsed.data.city),
      email: nullable(parsed.data.email),
      first_name: parsed.data.firstName,
      last_name: parsed.data.lastName,
      marketing_email_opted_in: formData.get('marketingEmailOptedIn') === 'on',
      notes: nullable(parsed.data.notes),
      phone: nullable(parsed.data.phone),
      postal_code: nullable(parsed.data.postalCode),
      state_code: nullable(parsed.data.stateCode),
      street_address: nullable(parsed.data.streetAddress),
      transactional_email_allowed:
        formData.get('transactionalEmailAllowed') === 'on',
    })
    .eq('id', customerId.data)
    .eq('tenant_id', context.tenantId)
    .is('archived_at', null)
    .select('id')
    .maybeSingle();

  if (error || !data) {
    return {
      message: 'Customer could not be updated.',
      status: 'error',
    };
  }

  revalidatePath('/app/customers');
  revalidatePath(`/app/customers/${customerId.data}`);
  return { message: 'Customer updated.', status: 'success' };
}

export async function archiveCustomerAction(formData: FormData): Promise<void> {
  const customerId = customerIdSchema.safeParse(formData.get('customerId'));
  if (!customerId.success) return;

  const context = await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const { error } = await supabase
    .from('customers')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', customerId.data)
    .eq('tenant_id', context.tenantId)
    .is('archived_at', null);

  if (error) throw new Error('Customer could not be archived.');
  revalidatePath('/app/customers');
  redirect('/app/customers');
}
