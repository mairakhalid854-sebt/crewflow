'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { isUsCityForState } from '../../lib/location/us-locations';
import { createClient } from '../../lib/supabase/server';

export interface OnboardingFormState {
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  readonly message?: string;
  readonly status: 'idle' | 'error';
}

const onboardingSchema = z
  .object({
    businessEmail: z
      .email('Enter a valid business email.')
      .trim()
      .toLowerCase(),
    city: z.string().trim().min(2, 'Select a city.').max(100),
    displayName: z.string().trim().min(2, 'Enter a display name.').max(120),
    legalName: z
      .string()
      .trim()
      .min(2, 'Enter the legal business name.')
      .max(160),
    phone: z.string().trim().max(30),
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{5}(-\d{4})?$/, 'Enter a valid US ZIP code.'),
    serviceCategories: z
      .array(z.string())
      .min(1, 'Select at least one service category.'),
    stateCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, 'Select a state.'),
    streetAddress: z.string().trim().min(3, 'Enter a street address.').max(180),
    taxRatePercent: z.coerce.number().min(0).max(100),
    timeZone: z.enum([
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Phoenix',
      'America/Los_Angeles',
      'America/Anchorage',
      'Pacific/Honolulu',
    ]),
  })
  .refine((value) => isUsCityForState(value.city, value.stateCode), {
    message: 'Select a city in the chosen state.',
    path: ['city'],
  });

export async function completeOnboardingAction(
  _previousState: OnboardingFormState,
  formData: FormData,
): Promise<OnboardingFormState> {
  const parsed = onboardingSchema.safeParse({
    businessEmail: formData.get('businessEmail'),
    city: formData.get('city'),
    displayName: formData.get('displayName'),
    legalName: formData.get('legalName'),
    phone: formData.get('phone'),
    postalCode: formData.get('postalCode'),
    serviceCategories: formData.getAll('serviceCategories'),
    stateCode: formData.get('stateCode'),
    streetAddress: formData.get('streetAddress'),
    taxRatePercent: formData.get('taxRatePercent'),
    timeZone: formData.get('timeZone'),
  });

  if (!parsed.success) {
    return {
      fieldErrors: parsed.error.flatten().fieldErrors,
      message: 'Please correct the highlighted fields.',
      status: 'error',
    };
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims) redirect('/login');

  const { error } = await supabase.rpc('create_tenant_with_owner', {
    business_email: parsed.data.businessEmail,
    city: parsed.data.city,
    display_name: parsed.data.displayName,
    legal_name: parsed.data.legalName,
    phone: parsed.data.phone,
    postal_code: parsed.data.postalCode,
    service_categories: parsed.data.serviceCategories,
    state_code: parsed.data.stateCode,
    street_address: parsed.data.streetAddress,
    tax_rate_bps: Math.round(parsed.data.taxRatePercent * 100),
    time_zone: parsed.data.timeZone,
  });

  if (error) {
    return {
      message:
        error.code === '23505'
          ? 'This account already belongs to an active CrewFlow workspace.'
          : 'Company setup could not be completed. Please review the details and try again.',
      status: 'error',
    };
  }

  redirect('/app');
}
