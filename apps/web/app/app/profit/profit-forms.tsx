'use client';

import { useActionState } from 'react';

import {
  type ProfitFormState,
  saveMarketPriceAction,
  saveProfitSettingsAction,
} from './actions';

const initialState: ProfitFormState = { status: 'idle' };

function Message({ state }: { readonly state: ProfitFormState }) {
  if (!state.message) return null;
  return (
    <p
      className={`profit-form-message profit-form-${state.status}`}
      role={state.status === 'error' ? 'alert' : 'status'}
    >
      {state.message}
    </p>
  );
}

export function ProfitSettingsForm({
  laborCostDollars,
  targetMarginPercent,
}: {
  readonly laborCostDollars: string;
  readonly targetMarginPercent: number;
}) {
  const [state, action, pending] = useActionState(
    saveProfitSettingsAction,
    initialState,
  );
  return (
    <form action={action} className="profit-settings-form">
      <label>
        <span>Labor cost per hour (USD)</span>
        <input
          defaultValue={laborCostDollars}
          inputMode="decimal"
          name="laborCost"
          placeholder="e.g. 45"
        />
        <small>
          What one technician hour really costs you: wage, payroll tax,
          insurance, vehicle, and overhead.
        </small>
      </label>
      <label>
        <span>Target profit margin (%)</span>
        <input
          defaultValue={targetMarginPercent}
          max={90}
          min={0}
          name="targetMargin"
          type="number"
        />
      </label>
      <button className="primary-button" disabled={pending} type="submit">
        {pending ? 'Saving…' : 'Save cost settings'}
      </button>
      <Message state={state} />
    </form>
  );
}

export function MarketPriceForm({
  checkedOn,
  high,
  low,
  serviceId,
  source,
}: {
  readonly checkedOn: string;
  readonly high: string;
  readonly low: string;
  readonly serviceId: string;
  readonly source: string;
}) {
  const [state, action, pending] = useActionState(
    saveMarketPriceAction,
    initialState,
  );
  const hasPrice = low !== '';
  return (
    <form action={action} className="market-price-form">
      <input name="serviceId" type="hidden" value={serviceId} />
      <label>
        <span>Low (USD)</span>
        <input defaultValue={low} inputMode="decimal" name="low" required />
      </label>
      <label>
        <span>High (USD)</span>
        <input defaultValue={high} inputMode="decimal" name="high" required />
      </label>
      <label className="market-price-source">
        <span>Where you found it</span>
        <input
          defaultValue={source}
          maxLength={200}
          name="source"
          placeholder="e.g. 3 local competitor websites, or HomeGuide 2026"
          required
        />
      </label>
      <label>
        <span>Date checked</span>
        <input defaultValue={checkedOn} name="checkedOn" required type="date" />
      </label>
      <div className="market-price-actions">
        <button
          className="secondary-button"
          disabled={pending}
          name="intent"
          type="submit"
          value="save"
        >
          {pending ? 'Saving…' : 'Save market price'}
        </button>
        {hasPrice ? (
          <button
            className="link-button"
            disabled={pending}
            formNoValidate
            name="intent"
            type="submit"
            value="clear"
          >
            Remove
          </button>
        ) : null}
      </div>
      <Message state={state} />
    </form>
  );
}
