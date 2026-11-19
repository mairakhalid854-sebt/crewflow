'use client';

import { type FormEvent, useState, useTransition } from 'react';

import {
  type BookingConfirmation,
  type BookingErrorCode,
  type BookingSlot,
  type PublicBookingPage,
  bookingCopy,
  formatDuration,
  formatPrice,
  formatSlot,
  groupSlotsByDay,
} from '../../../lib/booking/public-booking';
import type { PublicLocale } from '../../../lib/i18n/public-copy';
import { fetchBookingSlotsAction, submitBookingAction } from './actions';

type Props = {
  readonly locale: PublicLocale;
  readonly page: PublicBookingPage;
  readonly referralCode?: string | undefined;
};

const zoneNames: Record<string, string> = {
  'America/New_York': 'Eastern',
  'America/Chicago': 'Central',
  'America/Denver': 'Mountain',
  'America/Phoenix': 'Arizona',
  'America/Los_Angeles': 'Pacific',
  'America/Anchorage': 'Alaska',
  'Pacific/Honolulu': 'Hawaii',
};

export function BookingFlow({ locale, page, referralCode }: Props) {
  const t = bookingCopy(locale);
  const [serviceId, setServiceId] = useState<string>();
  const [zip, setZip] = useState('');
  const [slots, setSlots] = useState<BookingSlot[]>();
  const [startsAt, setStartsAt] = useState<string>();
  const [error, setError] = useState<BookingErrorCode>();
  const [confirmation, setConfirmation] = useState<BookingConfirmation>();
  const [pending, startTransition] = useTransition();

  const service = page.services.find((item) => item.id === serviceId);
  const zoneName = zoneNames[page.time_zone] ?? page.time_zone;

  function chooseService(id: string) {
    setServiceId(id);
    setSlots(undefined);
    setStartsAt(undefined);
    setError(undefined);
  }

  function findTimes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!serviceId) return;
    const cleanZip = zip.trim().slice(0, 5);
    setError(undefined);
    setStartsAt(undefined);
    startTransition(async () => {
      const result = await fetchBookingSlotsAction({
        serviceId,
        slug: page.slug,
        zip: cleanZip,
      });
      if (result.ok) setSlots(result.value);
      else {
        setSlots(undefined);
        setError(result.error);
      }
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!serviceId || !startsAt) return;
    const form = new FormData(event.currentTarget);
    const text = (name: string) =>
      (() => {
        const value = form.get(name);
        return typeof value === 'string' ? value.trim() : '';
      })();
    setError(undefined);
    startTransition(async () => {
      const result = await submitBookingAction({
        email: text('email'),
        firstName: text('firstName'),
        language: locale,
        lastName: text('lastName'),
        marketing: form.get('marketing') === 'on',
        note: text('note'),
        phone: text('phone'),
        serviceId,
        slug: page.slug,
        startsAt,
        street: text('street'),
        referralCode: referralCode ?? '',
        website: text('website'),
        zip: zip.trim(),
      });
      if (result.ok) {
        setConfirmation(result.value);
        return;
      }
      setError(result.error);
      if (result.error === 'taken') {
        setStartsAt(undefined);
        const refreshed = await fetchBookingSlotsAction({
          serviceId,
          slug: page.slug,
          zip: zip.trim().slice(0, 5),
        });
        if (refreshed.ok) setSlots(refreshed.value);
      }
    });
  }

  if (confirmation) {
    const when =
      confirmation.starts_at &&
      formatSlot(confirmation.starts_at, page.time_zone, locale);
    return (
      <section aria-live="polite" className="public-booking-done">
        <span aria-hidden="true" className="public-booking-check">
          ✓
        </span>
        <h2>{t.doneTitle}</h2>
        <p>
          {t.doneBody(
            confirmation.service_name ?? service?.name ?? '',
            when || '',
          )}
        </p>
        {confirmation.reference ? (
          <p className="public-booking-reference">
            {t.doneReference(confirmation.reference)}
          </p>
        ) : null}
        <p>{t.doneEmail}</p>
        <button
          className="public-booking-secondary"
          onClick={() => {
            setConfirmation(undefined);
            setServiceId(undefined);
            setSlots(undefined);
            setStartsAt(undefined);
          }}
          type="button"
        >
          {t.bookAnother}
        </button>
      </section>
    );
  }

  const days = slots ? groupSlotsByDay(slots, page.time_zone, locale) : [];

  return (
    <div className="public-booking-flow">
      <section aria-labelledby="booking-step-1" className="public-booking-step">
        <h2 id="booking-step-1">{t.step1}</h2>
        <div className="public-booking-services" role="radiogroup">
          {page.services.map((item) => (
            <button
              aria-checked={item.id === serviceId}
              className="public-booking-service"
              key={item.id}
              onClick={() => chooseService(item.id)}
              role="radio"
              type="button"
            >
              <strong>{item.name}</strong>
              {item.description ? <span>{item.description}</span> : null}
              <em>
                {formatPrice(item.price_cents, locale)} ·{' '}
                {formatDuration(item.duration_minutes, locale)}
              </em>
            </button>
          ))}
        </div>
      </section>

      {service ? (
        <section
          aria-labelledby="booking-step-2"
          className="public-booking-step"
        >
          <h2 id="booking-step-2">{t.step2}</h2>
          <form className="public-booking-zip" onSubmit={findTimes}>
            <label htmlFor="booking-zip">{t.zipLabel}</label>
            <div>
              <input
                autoComplete="postal-code"
                id="booking-zip"
                inputMode="numeric"
                maxLength={10}
                onChange={(event) => setZip(event.target.value)}
                pattern="\d{5}(-\d{4})?"
                required
                value={zip}
              />
              <button
                className="public-booking-primary"
                disabled={pending}
                type="submit"
              >
                {pending && !slots ? t.loadingTimes : t.findTimes}
              </button>
            </div>
            <small>{t.zipHint}</small>
          </form>
        </section>
      ) : null}

      {service && slots ? (
        <section
          aria-labelledby="booking-step-3"
          className="public-booking-step"
        >
          <h2 id="booking-step-3">{t.step3}</h2>
          {days.length === 0 ? (
            <p className="public-booking-empty">{t.noTimes}</p>
          ) : (
            <>
              <p className="public-booking-note">{t.timesNote(zoneName)}</p>
              <div className="public-booking-days">
                {days.map((day) => (
                  <fieldset className="public-booking-day" key={day.day}>
                    <legend>{day.label}</legend>
                    <div>
                      {day.slots.map((slot) => (
                        <button
                          aria-pressed={slot.startsAt === startsAt}
                          className="public-booking-time"
                          key={slot.startsAt}
                          onClick={() => {
                            setStartsAt(slot.startsAt);
                            setError(undefined);
                          }}
                          type="button"
                        >
                          {slot.time}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
            </>
          )}
        </section>
      ) : null}

      {service && startsAt ? (
        <section
          aria-labelledby="booking-step-4"
          className="public-booking-step"
        >
          <h2 id="booking-step-4">{t.step4}</h2>
          <p className="public-booking-summary">
            <strong>{service.name}</strong>
            {' · '}
            {formatSlot(startsAt, page.time_zone, locale)}
          </p>
          <form className="public-booking-details" onSubmit={submit}>
            <label>
              <span>{t.firstName}</span>
              <input
                autoComplete="given-name"
                maxLength={80}
                name="firstName"
                required
              />
            </label>
            <label>
              <span>{t.lastName}</span>
              <input
                autoComplete="family-name"
                maxLength={80}
                name="lastName"
                required
              />
            </label>
            <label>
              <span>{t.email}</span>
              <input
                autoComplete="email"
                maxLength={254}
                name="email"
                type="email"
              />
            </label>
            <label>
              <span>{t.phone}</span>
              <input
                autoComplete="tel"
                inputMode="tel"
                maxLength={30}
                name="phone"
                type="tel"
              />
            </label>
            <small className="public-booking-wide">{t.contactHint}</small>
            <label className="public-booking-wide">
              <span>{t.street}</span>
              <input
                autoComplete="street-address"
                maxLength={200}
                name="street"
                required
              />
            </label>
            <label className="public-booking-wide">
              <span>{t.note}</span>
              <textarea maxLength={1000} name="note" rows={3} />
            </label>
            <label className="public-booking-wide public-booking-check-field">
              <input name="marketing" type="checkbox" />
              <span>{t.marketing}</span>
            </label>
            <div aria-hidden="true" className="public-booking-trap">
              <label>
                Website
                <input autoComplete="off" name="website" tabIndex={-1} />
              </label>
            </div>
            <button
              className="public-booking-primary public-booking-wide"
              disabled={pending}
              type="submit"
            >
              {pending ? t.submitting : t.submit}
            </button>
          </form>
        </section>
      ) : null}

      {error ? (
        <p className="public-booking-error" role="alert">
          {t.errors[error]}
        </p>
      ) : null}
    </div>
  );
}
