'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { createClient } from '../../../lib/supabase/server';

export interface ProfitFormState {
  readonly message?: string;
  readonly status: 'idle' | 'error' | 'success';
}

const dollars = z
  .string()
  .trim()
  .regex(/^\d{1,6}(\.\d{1,2})?$/, 'Enter an amount like 45 or 45.50.')
  .transform((value) => Math.round(Number(value) * 100));

const costSchema = z.object({
  laborCost: z.union([z.literal('').transform(() => null), dollars]),
  targetMargin: z.coerce.number().int().min(0).max(90),
});

export async function saveProfitSettingsAction(
  _previous: ProfitFormState,
  formData: FormData,
): Promise<ProfitFormState> {
  const context = await requireTenantContext(['owner']);
  const parsed = costSchema.safeParse({
    laborCost: formData.get('laborCost') ?? '',
    targetMargin: formData.get('targetMargin'),
  });
  if (!parsed.success) {
    return {
      message:
        'Enter labor cost per hour in dollars and a target margin from 0 to 90%.',
      status: 'error',
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('tenant_settings')
    .update({
      profit_labor_cost_cents_per_hour: parsed.data.laborCost,
      profit_target_margin_bps: parsed.data.targetMargin * 100,
    })
    .eq('tenant_id', context.tenantId);

  revalidatePath('/app/profit');
  if (error) {
    return { message: 'Settings could not be saved.', status: 'error' };
  }
  return { message: 'Cost settings saved.', status: 'success' };
}

const marketSchema = z
  .object({
    checkedOn: z.iso.date(),
    high: dollars,
    low: dollars,
    serviceId: z.uuid(),
    source: z.string().trim().min(2).max(200),
  })
  .refine((value) => value.high >= value.low, {
    message: 'The high price must be at least the low price.',
  });

export async function saveMarketPriceAction(
  _previous: ProfitFormState,
  formData: FormData,
): Promise<ProfitFormState> {
  await requireTenantContext(['owner']);
  const supabase = await createClient();

  if (formData.get('intent') === 'clear') {
    const serviceId = z.uuid().safeParse(formData.get('serviceId'));
    if (!serviceId.success) {
      return { message: 'Service not found.', status: 'error' };
    }
    const { error } = await supabase.rpc('set_service_market_price', {
      target_checked_on: null,
      target_high_cents: null,
      target_low_cents: null,
      target_service_id: serviceId.data,
      target_source: null,
    });
    revalidatePath('/app/profit');
    return error
      ? { message: 'Market price could not be cleared.', status: 'error' }
      : { message: 'Market price removed.', status: 'success' };
  }

  const parsed = marketSchema.safeParse({
    checkedOn: formData.get('checkedOn'),
    high: formData.get('high'),
    low: formData.get('low'),
    serviceId: formData.get('serviceId'),
    source: formData.get('source'),
  });
  if (!parsed.success) {
    return {
      message:
        'Enter a low and high price, where you found it, and the date you checked.',
      status: 'error',
    };
  }

  const { error } = await supabase.rpc('set_service_market_price', {
    target_checked_on: parsed.data.checkedOn,
    target_high_cents: parsed.data.high,
    target_low_cents: parsed.data.low,
    target_service_id: parsed.data.serviceId,
    target_source: parsed.data.source,
  });
  revalidatePath('/app/profit');
  if (error) {
    return { message: 'Market price could not be saved.', status: 'error' };
  }
  return { message: 'Market price saved.', status: 'success' };
}
