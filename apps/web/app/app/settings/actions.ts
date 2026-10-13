'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { Json } from '@crewflow/database';

import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { isUsCityForState } from '../../../lib/location/us-locations';
import { createClient } from '../../../lib/supabase/server';

export interface CompanySettingsActionState {
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  readonly message?: string;
  readonly status: 'idle' | 'error' | 'success';
}

const serviceCategorySchema = z.enum([
  'HVAC',
  'Plumbing',
  'Electrical',
  'Cleaning',
  'Pest control',
  'Other',
]);
const timeZoneSchema = z.enum([
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
]);
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const companySettingsSchema = z
  .object({
    aiMonthlyBudgetDollars: z.coerce
      .number()
      .min(0, 'AI budget cannot be negative.')
      .max(1_000_000, 'AI budget cannot exceed $1,000,000.')
      .multipleOf(0.01, 'Use no more than two decimal places.'),
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
      .array(serviceCategorySchema)
      .min(1, 'Select at least one service category.'),
    stateCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, 'Select a state.'),
    streetAddress: z.string().trim().min(3, 'Enter a street address.').max(180),
    taxRatePercent: z.coerce.number().min(0).max(100),
    timeZone: timeZoneSchema,
  })
  .refine((value) => isUsCityForState(value.city, value.stateCode), {
    message: 'Select a city in the chosen state.',
    path: ['city'],
  });

function failure(message: string): CompanySettingsActionState {
  return { message, status: 'error' };
}

export async function updateCompanySettingsAction(
  _previousState: CompanySettingsActionState,
  formData: FormData,
): Promise<CompanySettingsActionState> {
  const parsed = companySettingsSchema.safeParse({
    aiMonthlyBudgetDollars: formData.get('aiMonthlyBudgetDollars'),
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
      message: 'Please correct the highlighted company details.',
      status: 'error',
    };
  }

  const weeklyHours: Json[] = [];
  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek += 1) {
    const isOpen = formData.get(`open-${dayOfWeek}`) === 'on';
    const opensAt = formData.get(`opens-${dayOfWeek}`);
    const closesAt = formData.get(`closes-${dayOfWeek}`);

    if (!isOpen) {
      weeklyHours.push({ dayOfWeek, isOpen: false });
      continue;
    }

    const parsedOpen = timeSchema.safeParse(opensAt);
    const parsedClose = timeSchema.safeParse(closesAt);
    if (
      !parsedOpen.success ||
      !parsedClose.success ||
      parsedOpen.data >= parsedClose.data
    ) {
      return failure(
        `${dayOfWeekLabel(dayOfWeek)} needs a valid opening and closing time.`,
      );
    }

    weeklyHours.push({
      closesAt: parsedClose.data,
      dayOfWeek,
      isOpen: true,
      opensAt: parsedOpen.data,
    });
  }

  await requireTenantContext(['owner']);
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_company_settings', {
    input_ai_monthly_budget_cents: Math.round(
      parsed.data.aiMonthlyBudgetDollars * 100,
    ),
    input_ai_operations_enabled: formData.get('aiOperationsEnabled') === 'on',
    input_business_email: parsed.data.businessEmail,
    input_city: parsed.data.city,
    input_display_name: parsed.data.displayName,
    input_legal_name: parsed.data.legalName,
    input_notifications_enabled: formData.get('notificationsEnabled') === 'on',
    input_phone: parsed.data.phone,
    input_postal_code: parsed.data.postalCode,
    input_service_categories: parsed.data.serviceCategories,
    input_state_code: parsed.data.stateCode,
    input_street_address: parsed.data.streetAddress,
    input_tax_rate_bps: Math.round(parsed.data.taxRatePercent * 100),
    input_time_zone: parsed.data.timeZone,
    input_weekly_hours: weeklyHours,
  });

  if (error)
    return failure('Company settings could not be saved. Please try again.');

  revalidatePath('/app', 'layout');
  revalidatePath('/app/settings');
  return {
    message: 'Company settings and business hours saved.',
    status: 'success',
  };
}

function dayOfWeekLabel(dayOfWeek: number): string {
  return (
    [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ][dayOfWeek] ?? 'Each open day'
  );
}
