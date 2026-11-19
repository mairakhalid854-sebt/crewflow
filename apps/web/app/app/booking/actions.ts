'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireTenantContext } from '../../../lib/auth/tenant-context';
import {
  bookingSlugPattern,
  normalizeBookingSlug,
} from '../../../lib/booking/public-booking';
import { createClient } from '../../../lib/supabase/server';

function field(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value : '';
}

export interface BookingPageActionState {
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  readonly message?: string;
  readonly status: 'idle' | 'error' | 'success';
}

const pageSchema = z.object({
  enabled: z.boolean(),
  headline: z
    .string()
    .trim()
    .max(120, 'Keep the headline under 120 characters.'),
  intro: z
    .string()
    .trim()
    .max(600, 'Keep the welcome text under 600 characters.'),
  slug: z
    .string()
    .transform(normalizeBookingSlug)
    .pipe(
      z
        .string()
        .regex(
          bookingSlugPattern,
          'Use 3 to 48 letters, numbers, or dashes, for example joes-hvac.',
        ),
    ),
});

export async function saveBookingPageAction(
  _previous: BookingPageActionState,
  formData: FormData,
): Promise<BookingPageActionState> {
  const context = await requireTenantContext(['owner']);
  const parsed = pageSchema.safeParse({
    enabled: formData.get('enabled') === 'on',
    headline: field(formData.get('headline')),
    intro: field(formData.get('intro')),
    slug: field(formData.get('slug')),
  });
  if (!parsed.success) {
    return {
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
      message: 'Check the highlighted fields.',
      status: 'error',
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('save_booking_page', {
    target_enabled: parsed.data.enabled,
    target_headline: parsed.data.headline,
    target_intro: parsed.data.intro,
    target_slug: parsed.data.slug,
    target_tenant_id: context.tenantId,
  });
  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes('already taken')) {
      return {
        fieldErrors: { slug: ['Another business already uses this link.'] },
        message: 'Choose a different link.',
        status: 'error',
      };
    }
    if (message.includes('reserved') || message.includes('slug')) {
      return {
        fieldErrors: { slug: ['This link is reserved. Choose another one.'] },
        message: 'Choose a different link.',
        status: 'error',
      };
    }
    if (message.includes('read-only')) {
      return {
        message: 'Choose a CrewFlow360 plan before publishing a booking page.',
        status: 'error',
      };
    }
    return { message: 'The booking page could not be saved.', status: 'error' };
  }

  revalidatePath('/app/booking');
  return {
    message: parsed.data.enabled
      ? 'Saved. Your booking page is live.'
      : 'Saved. The booking page is turned off.',
    status: 'success',
  };
}

export async function setServiceBookingAction(
  formData: FormData,
): Promise<void> {
  await requireTenantContext(['owner']);
  const serviceId = z.string().uuid().safeParse(formData.get('serviceId'));
  if (!serviceId.success) return;
  const supabase = await createClient();
  await supabase.rpc('set_service_online_booking', {
    target_enabled: formData.get('enabled') === 'true',
    target_service_id: serviceId.data,
  });
  revalidatePath('/app/booking');
}

export interface BookingDecisionState {
  readonly message?: string;
  readonly status: 'idle' | 'error' | 'success';
}

export async function decideBookingRequestAction(
  _previous: BookingDecisionState,
  formData: FormData,
): Promise<BookingDecisionState> {
  await requireTenantContext(['owner', 'office']);
  const requestId = z.string().uuid().safeParse(formData.get('requestId'));
  const decision = z
    .enum(['apply', 'dismiss'])
    .safeParse(formData.get('decision'));
  if (!requestId.success || !decision.success) {
    return { message: 'This request could not be updated.', status: 'error' };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc(
    decision.data === 'apply'
      ? 'apply_booking_request'
      : 'dismiss_booking_request',
    { target_request_id: requestId.data },
  );
  if (error) {
    const message = error.message.toLowerCase();
    return {
      message: message.includes('no longer free')
        ? 'That time is no longer free. Schedule this job from Dispatch instead.'
        : message.includes('already decided')
          ? 'Someone already handled this request.'
          : message.includes('no longer open')
            ? 'The job was closed or archived.'
            : 'This request could not be updated.',
      status: 'error',
    };
  }

  revalidatePath('/app/booking');
  revalidatePath('/app/jobs');
  return {
    message:
      decision.data === 'apply'
        ? 'The requested time and technician were added to the job.'
        : 'The request was dismissed.',
    status: 'success',
  };
}
