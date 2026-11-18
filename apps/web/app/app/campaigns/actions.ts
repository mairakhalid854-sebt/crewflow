'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { createClient } from '../../../lib/supabase/server';

function field(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value : '';
}

export interface CampaignActionState {
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  readonly message?: string;
  readonly status: 'idle' | 'error' | 'success';
}

const settingsSchema = z.object({
  enabled: z.boolean(),
  autoSend: z.boolean(),
  heat: z.coerce
    .number({ error: 'Enter a temperature.' })
    .int('Use a whole number.')
    .min(80, 'Use 80°F or more.')
    .max(120, 'Use 120°F or less.'),
  cold: z.coerce
    .number({ error: 'Enter a temperature.' })
    .int('Use a whole number.')
    .min(-20, 'Use -20°F or more.')
    .max(40, 'Use 40°F or less.'),
});

export async function saveCampaignSettingsAction(
  _previous: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  const context = await requireTenantContext(['owner']);
  const parsed = settingsSchema.safeParse({
    autoSend: formData.get('autoSend') === 'on',
    cold: field(formData.get('cold')),
    enabled: formData.get('enabled') === 'on',
    heat: field(formData.get('heat')),
  });
  if (!parsed.success) {
    return {
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
      message: 'Check the highlighted fields.',
      status: 'error',
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('save_weather_campaign_settings', {
    target_auto_send: parsed.data.autoSend,
    target_cold_threshold_f: parsed.data.cold,
    target_enabled: parsed.data.enabled,
    target_heat_threshold_f: parsed.data.heat,
    target_tenant_id: context.tenantId,
  });
  if (error) {
    return {
      message: error.message.toLowerCase().includes('read-only')
        ? 'Choose a CrewFlow360 plan before turning on campaigns.'
        : 'Settings could not be saved.',
      status: 'error',
    };
  }
  revalidatePath('/app/campaigns');
  return {
    message: parsed.data.enabled
      ? 'Saved. We check the forecast every morning.'
      : 'Saved. Weather campaigns are off.',
    status: 'success',
  };
}

export async function createCampaignAction(
  _previous: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  const context = await requireTenantContext(['owner']);
  const kind = z.enum(['heat', 'cold']).safeParse(formData.get('kind'));
  if (!kind.success) return { message: 'Choose a campaign.', status: 'error' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('create_manual_weather_campaign', {
    target_kind: kind.data,
    target_tenant_id: context.tenantId,
  });
  if (error) {
    return {
      message: error.message.toLowerCase().includes('no eligible')
        ? 'No one can receive this right now: either no past customers agreed to marketing email, or they were emailed recently, or a draft already exists.'
        : 'The campaign could not be created.',
      status: 'error',
    };
  }
  revalidatePath('/app/campaigns');
  return { message: 'Draft created. Review it below.', status: 'success' };
}

const sendSchema = z.object({
  campaignId: z.string().uuid(),
  subject: z.string().trim().min(3, 'Enter a subject.').max(150),
  body: z
    .string()
    .trim()
    .min(20, 'The message is too short.')
    .max(2000, 'Keep the message under 2,000 characters.'),
});

export async function sendCampaignAction(
  _previous: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  await requireTenantContext(['owner']);
  const decision = formData.get('decision');
  const campaignId = field(formData.get('campaignId'));
  const supabase = await createClient();

  if (decision === 'cancel') {
    const { error } = await supabase.rpc('cancel_weather_campaign', {
      target_campaign_id: campaignId,
    });
    if (error)
      return { message: 'The draft could not be cancelled.', status: 'error' };
    revalidatePath('/app/campaigns');
    return { message: 'Draft cancelled.', status: 'success' };
  }

  const parsed = sendSchema.safeParse({
    body: field(formData.get('body')),
    campaignId,
    subject: field(formData.get('subject')),
  });
  if (!parsed.success) {
    return {
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
      message: 'Check the highlighted fields.',
      status: 'error',
    };
  }

  const { data, error } = await supabase.rpc('send_weather_campaign', {
    target_body: parsed.data.body,
    target_campaign_id: parsed.data.campaignId,
    target_subject: parsed.data.subject,
  });
  if (error) {
    const message = error.message.toLowerCase();
    return {
      message: message.includes('booking page is off')
        ? 'Your booking page is off. Turn it on in Online booking, or remove {{booking_link}} from the message.'
        : message.includes('not a draft')
          ? 'This campaign was already handled.'
          : 'The campaign could not be sent.',
      status: 'error',
    };
  }
  revalidatePath('/app/campaigns');
  return {
    message: `Queued for ${data} customer${data === 1 ? '' : 's'}. Emails go out over the next few minutes.`,
    status: 'success',
  };
}
