'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { localDateTimeToIso } from '../../../lib/date-time';
import { createClient } from '../../../lib/supabase/server';

export interface TimeOffState {
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  readonly message?: string;
  readonly status: 'idle' | 'error' | 'success';
}

const timeOffSchema = z.object({
  endsLocal: z.string().trim().min(1, 'Enter an end date and time.'),
  membershipId: z.uuid(),
  reason: z.string().trim().max(500).default(''),
  startsLocal: z.string().trim().min(1, 'Enter a start date and time.'),
});

const cancelSchema = z.object({
  membershipId: z.uuid(),
  timeOffId: z.uuid(),
});

function revalidateStaff(membershipId: string): void {
  revalidatePath('/app/dispatch');
  revalidatePath(`/app/team/${membershipId}`);
}

export async function addTimeOffAction(
  _previousState: TimeOffState,
  formData: FormData,
): Promise<TimeOffState> {
  const parsed = timeOffSchema.safeParse({
    endsLocal: formData.get('endsLocal'),
    membershipId: formData.get('membershipId'),
    reason: formData.get('reason'),
    startsLocal: formData.get('startsLocal'),
  });
  if (!parsed.success) {
    return {
      fieldErrors: parsed.error.flatten().fieldErrors,
      message: 'Please correct the highlighted fields.',
      status: 'error',
    };
  }

  const context = await requireTenantContext(['owner', 'office']);
  const startsAt = localDateTimeToIso(
    parsed.data.startsLocal,
    context.timeZone,
  );
  const endsAt = localDateTimeToIso(parsed.data.endsLocal, context.timeZone);
  if (!startsAt || !endsAt || new Date(startsAt) >= new Date(endsAt)) {
    return {
      fieldErrors: { endsLocal: ['End must be after the start time.'] },
      message: 'Please correct the highlighted fields.',
      status: 'error',
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.from('staff_time_off').insert({
    ends_at: endsAt,
    membership_id: parsed.data.membershipId,
    reason: parsed.data.reason || null,
    starts_at: startsAt,
    tenant_id: context.tenantId,
  });

  if (error) {
    return {
      message:
        error.code === '23P01'
          ? 'This time-off period overlaps another active entry.'
          : error.message.toLocaleLowerCase().includes('technician')
            ? 'Time off can only be added for an active technician.'
            : 'Time off could not be saved. Please try again.',
      status: 'error',
    };
  }

  revalidateStaff(parsed.data.membershipId);
  return { message: 'Time off added.', status: 'success' };
}

export async function cancelTimeOffAction(
  _previousState: TimeOffState,
  formData: FormData,
): Promise<TimeOffState> {
  const parsed = cancelSchema.safeParse({
    membershipId: formData.get('membershipId'),
    timeOffId: formData.get('timeOffId'),
  });
  if (!parsed.success) {
    return { message: 'Invalid time-off entry.', status: 'error' };
  }

  const context = await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('staff_time_off')
    .update({ cancelled_at: new Date().toISOString() })
    .eq('id', parsed.data.timeOffId)
    .eq('membership_id', parsed.data.membershipId)
    .eq('tenant_id', context.tenantId)
    .is('cancelled_at', null)
    .select('id')
    .maybeSingle();

  if (error || !data) {
    return { message: 'Time off could not be cancelled.', status: 'error' };
  }

  revalidateStaff(parsed.data.membershipId);
  return { message: 'Time off cancelled.', status: 'success' };
}
