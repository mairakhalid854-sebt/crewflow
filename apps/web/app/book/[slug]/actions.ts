'use server';

import { z } from 'zod';

import {
  type BookingConfirmation,
  type BookingErrorCode,
  type BookingSlot,
  bookingConfirmationSchema,
  bookingErrorCode,
  bookingSlotSchema,
  bookingSlugPattern,
} from '../../../lib/booking/public-booking';
import { createClient } from '../../../lib/supabase/server';

type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: BookingErrorCode };

const slotsInput = z.object({
  slug: z.string().regex(bookingSlugPattern),
  serviceId: z.string().uuid(),
  zip: z.string().regex(/^\d{5}$/),
});

export async function fetchBookingSlotsAction(
  input: z.input<typeof slotsInput>,
): Promise<Result<BookingSlot[]>> {
  const parsed = slotsInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.some((issue) => issue.path[0] === 'zip')
        ? 'zip'
        : 'unavailable',
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_public_booking_slots', {
    target_postal_code: parsed.data.zip,
    target_service_id: parsed.data.serviceId,
    target_slug: parsed.data.slug,
  });
  if (error) return { ok: false, error: 'unknown' };
  const slots = z.array(bookingSlotSchema).safeParse(data ?? []);
  return slots.success
    ? { ok: true, value: slots.data }
    : { ok: false, error: 'unknown' };
}

const submitInput = z.object({
  slug: z.string().regex(bookingSlugPattern),
  serviceId: z.string().uuid(),
  startsAt: z.string().min(10).max(40),
  firstName: z.string().max(80),
  lastName: z.string().max(80),
  email: z.string().max(254),
  phone: z.string().max(30),
  street: z.string().max(200),
  zip: z.string().max(10),
  note: z.string().max(1000),
  language: z.enum(['en', 'es']),
  marketing: z.boolean(),
  website: z.string().max(200),
});

export async function submitBookingAction(
  input: z.input<typeof submitInput>,
): Promise<Result<BookingConfirmation>> {
  const parsed = submitInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'unknown' };
  const values = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('submit_public_booking', {
    target_email: values.email,
    target_first_name: values.firstName,
    target_language: values.language,
    target_last_name: values.lastName,
    target_marketing_opt_in: values.marketing,
    target_note: values.note,
    target_phone: values.phone,
    target_postal_code: values.zip,
    target_service_id: values.serviceId,
    target_slug: values.slug,
    target_starts_at: values.startsAt,
    target_street_address: values.street,
    target_website: values.website,
  });
  if (error) return { ok: false, error: bookingErrorCode(error.message) };
  const confirmation = bookingConfirmationSchema.safeParse(data);
  return confirmation.success
    ? { ok: true, value: confirmation.data }
    : { ok: false, error: 'unknown' };
}
