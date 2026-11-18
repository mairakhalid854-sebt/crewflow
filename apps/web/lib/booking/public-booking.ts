import { z } from 'zod';

import type { PublicLocale } from '../i18n/public-copy';

export const bookingSlugPattern = /^[a-z0-9](?:[a-z0-9-]{1,46})[a-z0-9]$/;

export const publicBookingPageSchema = z.object({
  slug: z.string(),
  business_name: z.string(),
  business_phone: z.string().nullable(),
  city: z.string().nullable(),
  state_code: z.string().nullable(),
  time_zone: z.string(),
  headline: z.string().nullable(),
  intro: z.string().nullable(),
  services: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      description: z.string().nullable(),
      price_cents: z.number().int().nonnegative(),
      duration_minutes: z.number().int().positive(),
    }),
  ),
});

export type PublicBookingPage = z.infer<typeof publicBookingPageSchema>;
export type PublicBookingService = PublicBookingPage['services'][number];

export const bookingSlotSchema = z.object({
  starts_at: z.string(),
  ends_at: z.string(),
});

export type BookingSlot = z.infer<typeof bookingSlotSchema>;

export const bookingConfirmationSchema = z.object({
  status: z.enum(['requested', 'received']),
  reference: z.string().optional(),
  starts_at: z.string().optional(),
  service_name: z.string().optional(),
  business_name: z.string().optional(),
});

export type BookingConfirmation = z.infer<typeof bookingConfirmationSchema>;

export function normalizeBookingSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function formatPrice(cents: number, locale: PublicLocale): string {
  return new Intl.NumberFormat(locale === 'es' ? 'es-US' : 'en-US', {
    currency: 'USD',
    style: 'currency',
  }).format(cents / 100);
}

export function formatDuration(minutes: number, locale: PublicLocale): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const h = locale === 'es' ? 'h' : 'hr';
  if (hours && rest) return `${hours} ${h} ${rest} min`;
  if (hours) return `${hours} ${h}`;
  return `${rest} min`;
}

/** Groups slots by the business's local calendar day, in order. */
export function groupSlotsByDay(
  slots: readonly BookingSlot[],
  timeZone: string,
  locale: PublicLocale,
): {
  day: string;
  label: string;
  slots: { startsAt: string; time: string }[];
}[] {
  const intlLocale = locale === 'es' ? 'es-US' : 'en-US';
  const dayKey = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  });
  const dayLabel = new Intl.DateTimeFormat(intlLocale, {
    day: 'numeric',
    month: 'short',
    timeZone,
    weekday: 'short',
  });
  const timeLabel = new Intl.DateTimeFormat(intlLocale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  });

  const days = new Map<
    string,
    { day: string; label: string; slots: { startsAt: string; time: string }[] }
  >();
  for (const slot of slots) {
    const date = new Date(slot.starts_at);
    if (Number.isNaN(date.getTime())) continue;
    const key = dayKey.format(date);
    let entry = days.get(key);
    if (!entry) {
      entry = { day: key, label: dayLabel.format(date), slots: [] };
      days.set(key, entry);
    }
    entry.slots.push({
      startsAt: slot.starts_at,
      time: timeLabel.format(date),
    });
  }
  return [...days.values()];
}

export function formatSlot(
  startsAt: string,
  timeZone: string,
  locale: PublicLocale,
): string {
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(startsAt));
}

export type BookingErrorCode =
  | 'unavailable'
  | 'service'
  | 'name'
  | 'contact'
  | 'email'
  | 'phone'
  | 'address'
  | 'zip'
  | 'taken'
  | 'limited'
  | 'unknown';

/** Maps a database error message to a safe, user-facing error code. */
export function bookingErrorCode(
  message: string | undefined,
): BookingErrorCode {
  const text = (message ?? '').toLowerCase();
  if (text.includes('booking page unavailable')) return 'unavailable';
  if (text.includes('service unavailable')) return 'service';
  if (text.includes('name required')) return 'name';
  if (text.includes('email or phone required')) return 'contact';
  if (text.includes('invalid email')) return 'email';
  if (text.includes('invalid phone')) return 'phone';
  if (text.includes('address required')) return 'address';
  if (text.includes('invalid zip')) return 'zip';
  if (text.includes('time no longer available')) return 'taken';
  if (text.includes('rate limited')) return 'limited';
  return 'unknown';
}

const en = {
  bookOnline: 'Book online',
  defaultHeadline: (business: string) => `Book a visit with ${business}`,
  step1: '1. Choose a service',
  step2: '2. Where is the job?',
  step3: '3. Pick a time',
  step4: '4. Your details',
  zipLabel: 'ZIP code',
  zipHint: 'We use it to show times when a technician can reach you.',
  findTimes: 'Show open times',
  loadingTimes: 'Finding open times…',
  noTimes:
    'No open times in the next two weeks for this ZIP code. Please call us instead.',
  timesNote: (zone: string) =>
    `Times are shown in the business's time zone (${zone}).`,
  change: 'Change',
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Mobile phone',
  contactHint: 'Give an email or a phone number so we can confirm.',
  street: 'Street address',
  note: 'Anything we should know? (optional)',
  marketing: 'Send me occasional offers and seasonal reminders by email.',
  submit: 'Request this time',
  submitting: 'Sending…',
  callUs: (phone: string) => `Questions? Call ${phone}.`,
  doneTitle: 'Request sent!',
  doneBody: (service: string, when: string) =>
    `We received your request for ${service} on ${when}. The business will confirm it soon.`,
  doneReference: (reference: string) => `Reference: ${reference}`,
  doneEmail: 'If you gave an email address, a confirmation is on its way.',
  bookAnother: 'Book another visit',
  errors: {
    unavailable:
      'Online booking is not available right now. Please call the business.',
    service: 'That service can no longer be booked online.',
    name: 'Please enter your first and last name.',
    contact: 'Please give an email or a phone number.',
    email: 'Please check the email address.',
    phone: 'Please enter a 10-digit US phone number.',
    address: 'Please enter the street address for the visit.',
    zip: 'Please enter a 5-digit ZIP code.',
    taken: 'Sorry, someone just took that time. Please pick another one.',
    limited: 'Too many requests. Please call the business or try again later.',
    unknown: 'Something went wrong. Please try again.',
  } satisfies Record<BookingErrorCode, string>,
  poweredBy: 'Online booking by CrewFlow360',
};

const es: typeof en = {
  bookOnline: 'Reserve en línea',
  defaultHeadline: (business) => `Reserve una visita con ${business}`,
  step1: '1. Elija un servicio',
  step2: '2. ¿Dónde es el trabajo?',
  step3: '3. Elija un horario',
  step4: '4. Sus datos',
  zipLabel: 'Código postal',
  zipHint: 'Lo usamos para mostrar horarios en que un técnico puede llegar.',
  findTimes: 'Ver horarios disponibles',
  loadingTimes: 'Buscando horarios…',
  noTimes:
    'No hay horarios en las próximas dos semanas para este código postal. Por favor llámenos.',
  timesNote: (zone) =>
    `Los horarios están en la zona horaria del negocio (${zone}).`,
  change: 'Cambiar',
  firstName: 'Nombre',
  lastName: 'Apellido',
  email: 'Correo electrónico',
  phone: 'Teléfono celular',
  contactHint: 'Dé un correo o un teléfono para poder confirmar.',
  street: 'Dirección',
  note: '¿Algo que debamos saber? (opcional)',
  marketing: 'Envíenme ofertas y recordatorios de temporada por correo.',
  submit: 'Solicitar este horario',
  submitting: 'Enviando…',
  callUs: (phone) => `¿Preguntas? Llame al ${phone}.`,
  doneTitle: '¡Solicitud enviada!',
  doneBody: (service, when) =>
    `Recibimos su solicitud de ${service} para el ${when}. El negocio la confirmará pronto.`,
  doneReference: (reference) => `Referencia: ${reference}`,
  doneEmail: 'Si dio un correo, le enviamos una confirmación.',
  bookAnother: 'Reservar otra visita',
  errors: {
    unavailable:
      'La reserva en línea no está disponible. Por favor llame al negocio.',
    service: 'Ese servicio ya no se puede reservar en línea.',
    name: 'Escriba su nombre y apellido.',
    contact: 'Dé un correo o un número de teléfono.',
    email: 'Revise el correo electrónico.',
    phone: 'Escriba un teléfono de EE. UU. de 10 dígitos.',
    address: 'Escriba la dirección de la visita.',
    zip: 'Escriba un código postal de 5 dígitos.',
    taken: 'Lo sentimos, alguien acaba de tomar ese horario. Elija otro.',
    limited: 'Demasiadas solicitudes. Llame al negocio o intente más tarde.',
    unknown: 'Algo salió mal. Intente de nuevo.',
  },
  poweredBy: 'Reservas en línea por CrewFlow360',
};

export function bookingCopy(locale: PublicLocale): typeof en {
  return locale === 'es' ? es : en;
}

export type BookingCopy = typeof en;
