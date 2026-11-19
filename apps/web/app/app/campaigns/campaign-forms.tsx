'use client';

import { useActionState } from 'react';

import {
  type CampaignActionState,
  createCampaignAction,
  saveCampaignSettingsAction,
  sendCampaignAction,
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

function Message({ state }: Readonly<{ state: CampaignActionState }>) {
  if (!state.message) return null;
  return (
    <p
      className={
        state.status === 'error' ? 'form-message-error' : 'form-message'
      }
      role={state.status === 'error' ? 'alert' : 'status'}
    >
      {state.message}
    </p>
  );
}

export function CampaignSettingsForm({
  settings,
}: Readonly<{
  settings: {
    enabled: boolean;
    auto_send: boolean;
    heat_threshold_f: number;
    cold_threshold_f: number;
  } | null;
}>) {
  const [state, action, pending] = useActionState<
    CampaignActionState,
    FormData
  >(saveCampaignSettingsAction, { status: 'idle' });
  return (
    <form action={action}>
      <section className="settings-section" aria-labelledby="campaign-settings">
        <div className="settings-section-heading">
          <h2 id="campaign-settings">Automatic weather check</h2>
          <p>
            Every morning we read the National Weather Service forecast for your
            business address. When the next 5 days cross these limits, a
            check-up email is drafted for your past customers.
          </p>
        </div>
        <div className="form-grid">
          <label>
            <span>Heat wave at or above (°F)</span>
            <input
              defaultValue={settings?.heat_threshold_f ?? 95}
              max="120"
              min="80"
              name="heat"
              type="number"
            />
            <FieldError errors={state.fieldErrors?.heat} id="heat-error" />
          </label>
          <label>
            <span>Freeze at or below (°F)</span>
            <input
              defaultValue={settings?.cold_threshold_f ?? 25}
              max="40"
              min="-20"
              name="cold"
              type="number"
            />
            <FieldError errors={state.fieldErrors?.cold} id="cold-error" />
          </label>
        </div>
        <label className="checkbox-field campaign-check">
          <input
            defaultChecked={settings?.enabled ?? false}
            name="enabled"
            type="checkbox"
          />
          <span>
            <strong>Weather campaigns are on.</strong> We email you when a
            campaign is ready.
          </span>
        </label>
        <label className="checkbox-field campaign-check">
          <input
            defaultChecked={settings?.auto_send ?? false}
            name="autoSend"
            type="checkbox"
          />
          <span>
            <strong>Send automatically</strong> without waiting for my review.
          </span>
        </label>
      </section>
      <Message state={state} />
      <div className="settings-save-bar">
        <p>Changes are recorded in the audit trail.</p>
        <button className="primary-button" disabled={pending} type="submit">
          {pending ? 'Saving...' : 'Save campaign settings'}
        </button>
      </div>
    </form>
  );
}

export function CreateCampaignButtons() {
  const [state, action, pending] = useActionState<
    CampaignActionState,
    FormData
  >(createCampaignAction, { status: 'idle' });
  return (
    <form action={action} className="campaign-create">
      <button
        className="secondary-button"
        disabled={pending}
        name="kind"
        type="submit"
        value="heat"
      >
        ☀️ AC check-up campaign
      </button>
      <button
        className="secondary-button"
        disabled={pending}
        name="kind"
        type="submit"
        value="cold"
      >
        ❄️ Heating check-up campaign
      </button>
      <Message state={state} />
    </form>
  );
}

export function CampaignDraft({
  campaign,
}: Readonly<{
  campaign: {
    id: string;
    subject: string;
    body: string;
    audience_count: number;
  };
}>) {
  const [state, action, pending] = useActionState<
    CampaignActionState,
    FormData
  >(sendCampaignAction, { status: 'idle' });
  if (state.status === 'success') return <Message state={state} />;
  return (
    <form action={action} className="campaign-draft">
      <input name="campaignId" type="hidden" value={campaign.id} />
      <label>
        <span>Subject</span>
        <input defaultValue={campaign.subject} maxLength={150} name="subject" />
        <FieldError
          errors={state.fieldErrors?.subject}
          id={`subject-${campaign.id}`}
        />
      </label>
      <label>
        <span>Message</span>
        <textarea
          defaultValue={campaign.body}
          maxLength={2000}
          name="body"
          rows={11}
        />
        <FieldError
          errors={state.fieldErrors?.body}
          id={`body-${campaign.id}`}
        />
      </label>
      <p className="campaign-hint">
        <code>{'{{first_name}}'}</code> becomes each customer&apos;s first name
        and <code>{'{{booking_link}}'}</code> becomes your booking page link. An
        unsubscribe link and your business address are added automatically.
      </p>
      <div className="campaign-actions">
        <button
          className="primary-button"
          disabled={pending}
          name="decision"
          type="submit"
          value="send"
        >
          Send to {campaign.audience_count} customer
          {campaign.audience_count === 1 ? '' : 's'}
        </button>
        <button
          className="secondary-button"
          disabled={pending}
          name="decision"
          type="submit"
          value="cancel"
        >
          Discard draft
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}
