'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { appUrl } from '../../../lib/app-url';
import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { createClient } from '../../../lib/supabase/server';

function field(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value : '';
}

export interface ReferralActionState {
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  readonly message?: string;
  readonly status: 'idle' | 'error' | 'success';
}

const dollars = z.coerce
  .number({ error: 'Enter an amount in dollars.' })
  .min(0, 'The reward cannot be negative.')
  .max(1000, 'Keep the reward at $1,000 or less.')
  .multipleOf(0.01, 'Use no more than two decimal places.');

const programSchema = z.object({
  enabled: z.boolean(),
  friendReward: dollars,
  referrerReward: dollars,
  rewardNote: z.string().trim().max(240, 'Keep the note under 240 characters.'),
});

export async function saveReferralProgramAction(
  _previous: ReferralActionState,
  formData: FormData,
): Promise<ReferralActionState> {
  const context = await requireTenantContext(['owner']);
  const parsed = programSchema.safeParse({
    enabled: formData.get('enabled') === 'on',
    friendReward: field(formData.get('friendReward')),
    referrerReward: field(formData.get('referrerReward')),
    rewardNote: field(formData.get('rewardNote')),
  });
  if (!parsed.success) {
    return {
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
      message: 'Check the highlighted fields.',
      status: 'error',
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('save_referral_program', {
    target_enabled: parsed.data.enabled,
    target_friend_reward_cents: Math.round(parsed.data.friendReward * 100),
    target_referrer_reward_cents: Math.round(parsed.data.referrerReward * 100),
    target_reward_note: parsed.data.rewardNote,
    target_tenant_id: context.tenantId,
  });
  if (error) {
    return {
      message: error.message.toLowerCase().includes('read-only')
        ? 'Choose a CrewFlow360 plan before starting a referral program.'
        : 'The referral program could not be saved.',
      status: 'error',
    };
  }

  revalidatePath('/app/referrals');
  return {
    message: parsed.data.enabled
      ? 'Saved. Referral links now work on your booking page.'
      : 'Saved. The referral program is off.',
    status: 'success',
  };
}

export async function decideReferralAction(
  _previous: ReferralActionState,
  formData: FormData,
): Promise<ReferralActionState> {
  await requireTenantContext(['owner', 'office']);
  const referralId = z.string().uuid().safeParse(formData.get('referralId'));
  const decision = z
    .enum(['reward', 'void'])
    .safeParse(formData.get('decision'));
  if (!referralId.success || !decision.success) {
    return { message: 'This referral could not be updated.', status: 'error' };
  }

  const supabase = await createClient();
  const { error } =
    decision.data === 'reward'
      ? await supabase.rpc('mark_referral_rewarded', {
          target_referral_id: referralId.data,
        })
      : await supabase.rpc('void_referral', {
          target_reason:
            field(formData.get('reason')).trim() ||
            'Not eligible for the reward.',
          target_referral_id: referralId.data,
        });
  if (error) {
    return {
      message: error.message.toLowerCase().includes('only qualified')
        ? 'Rewards can be given after the referred job is completed.'
        : 'This referral could not be updated. Refresh and try again.',
      status: 'error',
    };
  }

  revalidatePath('/app/referrals');
  return {
    message:
      decision.data === 'reward'
        ? 'Marked as rewarded.'
        : 'The referral was cancelled.',
    status: 'success',
  };
}

export interface ReferralLinkState {
  readonly link?: string;
  readonly message?: string;
  readonly status: 'idle' | 'error' | 'success';
}

export async function referralLinkAction(
  _previous: ReferralLinkState,
  formData: FormData,
): Promise<ReferralLinkState> {
  const context = await requireTenantContext(['owner', 'office']);
  const customerId = z.string().uuid().safeParse(formData.get('customerId'));
  if (!customerId.success) {
    return { message: 'The link could not be created.', status: 'error' };
  }

  const supabase = await createClient();
  const [{ data: code, error }, { data: page }] = await Promise.all([
    supabase.rpc('get_customer_referral_code', {
      target_customer_id: customerId.data,
    }),
    supabase
      .from('booking_pages')
      .select('slug, enabled')
      .eq('tenant_id', context.tenantId)
      .maybeSingle(),
  ]);
  if (error || !code) {
    return { message: 'The link could not be created.', status: 'error' };
  }
  if (!page?.enabled) {
    return {
      message:
        'Turn on your booking page first (Online booking), then share links.',
      status: 'error',
    };
  }

  return {
    link: `${appUrl()}/book/${page.slug}?ref=${code}`,
    status: 'success',
  };
}
