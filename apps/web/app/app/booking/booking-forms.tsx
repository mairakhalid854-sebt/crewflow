'use client';

import { useActionState, useState } from 'react';

import { normalizeBookingSlug } from '../../../lib/booking/public-booking';
import {
  type BookingDecisionState,
  type BookingPageActionState,
  decideBookingRequestAction,
  saveBookingPageAction,
} from './actions';

function FieldError({
  errors,
  id,
}: Readonly<{ errors?: readonly string[]; id: string }>) {
  if (!errors?.length) return null;
  return (
    <p className="field-error" id={id} role="alert">
      {errors[0]}
    </p>
  );
}

export function BookingPageForm({
  appUrl,
  page,
  suggestedSlug,
}: Readonly<{
  appUrl: string;
  page: {
    enabled: boolean;
    headline: string | null;
    intro: string | null;
    slug: string;
  } | null;
  suggestedSlug: string;
}>) {
  const [state, action, pending] = useActionState<
    BookingPageActionState,
    FormData
  >(saveBookingPageAction, { status: 'idle' });
  const [slug, setSlug] = useState(page?.slug ?? suggestedSlug);
  const [copied, setCopied] = useState(false);
  const cleanSlug = normalizeBookingSlug(slug) || 'your-business';
  const link = `${appUrl}/book/${cleanSlug}`;

  return (
    <form action={action} className="booking-settings-form">
      <section className="settings-section" aria-labelledby="booking-link">
        <div className="settings-section-heading">
          <h2 id="booking-link">Your booking link</h2>
          <p>
            Customers open this link to pick a service and an open time. Put it
            on your website, Google Business Profile, Facebook, and email
            signature.
          </p>
        </div>
        <div className="form-grid">
          <label>
            <span>Link name *</span>
            <input
              aria-describedby="slug-help slug-error"
              aria-invalid={Boolean(state.fieldErrors?.slug)}
              maxLength={48}
              name="slug"
              onChange={(event) => setSlug(event.target.value)}
              required
              value={slug}
            />
            <small id="slug-help">Letters, numbers, and dashes only.</small>
            <FieldError errors={state.fieldErrors?.slug} id="slug-error" />
          </label>
          <div className="booking-link-preview">
            <span>Your link</span>
            <code>{link}</code>
            <button
              className="secondary-button"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(link)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
              type="button"
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
          <label>
            <span>Headline</span>
            <input
              defaultValue={page?.headline ?? ''}
              maxLength={120}
              name="headline"
              placeholder="Book your AC tune-up online"
            />
            <FieldError
              errors={state.fieldErrors?.headline}
              id="headline-error"
            />
          </label>
          <label>
            <span>Welcome text</span>
            <textarea
              defaultValue={page?.intro ?? ''}
              maxLength={600}
              name="intro"
              placeholder="Family-owned since 2009. Licensed and insured."
              rows={3}
            />
            <FieldError errors={state.fieldErrors?.intro} id="intro-error" />
          </label>
        </div>
        <label className="checkbox-field booking-enable">
          <input
            defaultChecked={page?.enabled ?? false}
            name="enabled"
            type="checkbox"
          />
          <span>
            <strong>Booking page is on.</strong> Customers can request times
            through the link.
          </span>
        </label>
      </section>

      {state.message ? (
        <p
          className={
            state.status === 'error' ? 'form-message-error' : 'form-message'
          }
          role={state.status === 'error' ? 'alert' : 'status'}
        >
          {state.message}
        </p>
      ) : null}

      <div className="settings-save-bar">
        <p>Changes are recorded in the audit trail.</p>
        <button className="primary-button" disabled={pending} type="submit">
          {pending ? 'Saving...' : 'Save booking page'}
        </button>
      </div>
    </form>
  );
}

export function BookingDecisionButtons({
  requestId,
}: Readonly<{ requestId: string }>) {
  const [state, action, pending] = useActionState<
    BookingDecisionState,
    FormData
  >(decideBookingRequestAction, { status: 'idle' });

  if (state.status === 'success') {
    return (
      <p className="form-message" role="status">
        {state.message}
      </p>
    );
  }

  return (
    <form action={action} className="booking-decision">
      <input name="requestId" type="hidden" value={requestId} />
      <button
        className="primary-button"
        disabled={pending}
        name="decision"
        type="submit"
        value="apply"
      >
        Apply requested time
      </button>
      <button
        className="secondary-button"
        disabled={pending}
        name="decision"
        type="submit"
        value="dismiss"
      >
        Dismiss
      </button>
      {state.status === 'error' ? (
        <p className="field-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
