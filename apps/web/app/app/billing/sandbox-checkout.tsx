'use client';

import { useRef, useState } from 'react';

import { initializePaddle, type Paddle } from '@paddle/paddle-js';

import {
  checkoutCustomData,
  type SandboxCheckoutPlan,
} from './paddle-checkout';

interface SandboxCheckoutProps {
  readonly clientToken: string;
  readonly plans: readonly SandboxCheckoutPlan[];
  readonly tenantId: string;
}

function formatPrice(plan: SandboxCheckoutPlan): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: plan.currencyCode,
    maximumFractionDigits: 0,
  }).format(plan.amountCents / 100);
}

export function SandboxCheckout({
  clientToken,
  plans,
  tenantId,
}: SandboxCheckoutProps) {
  const paddleRef = useRef<Promise<Paddle | undefined> | null>(null);
  const [openingPlan, setOpeningPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openCheckout(plan: SandboxCheckoutPlan): Promise<void> {
    setError(null);
    setOpeningPlan(plan.code);

    try {
      paddleRef.current ??= initializePaddle({
        environment: 'sandbox',
        token: clientToken,
      });
      const paddle = await paddleRef.current;
      if (!paddle) throw new Error('Paddle sandbox could not be initialized.');

      paddle.Checkout.open({
        items: [{ priceId: plan.priceId, quantity: 1 }],
        customData: checkoutCustomData(tenantId),
        settings: {
          displayMode: 'overlay',
          locale: 'en',
          successUrl: `${window.location.origin}/app/billing?checkout=success`,
          theme: 'light',
        },
      });
    } catch {
      paddleRef.current = null;
      setError('Sandbox checkout could not be opened. Please try again.');
    } finally {
      setOpeningPlan(null);
    }
  }

  return (
    <section className="billing-plan-panel" aria-labelledby="sandbox-plans">
      <div>
        <p className="workspace-kicker">Sandbox catalog</p>
        <h2 id="sandbox-plans">Test a CrewFlow subscription</h2>
        <p>
          These checkouts use Paddle test mode. No real card is charged and no
          live subscription is created.
        </p>
      </div>
      <div className="billing-plan-grid">
        {plans.map((plan) => (
          <article className="billing-plan-card" key={plan.code}>
            <h3>{plan.displayName}</h3>
            <strong>
              {formatPrice(plan)}
              <span>/{plan.billingInterval}</span>
            </strong>
            <p>
              {plan.seatLimit === null
                ? 'Seats not configured'
                : `Up to ${plan.seatLimit} team members`}
            </p>
            <small>
              {plan.trialDays > 0
                ? `${plan.trialDays}-day sandbox trial`
                : 'No trial'}
            </small>
            <button
              className="primary-button"
              disabled={openingPlan !== null}
              onClick={() => void openCheckout(plan)}
              type="button"
            >
              {openingPlan === plan.code ? 'Opening…' : 'Start test checkout'}
            </button>
          </article>
        ))}
      </div>
      {error ? (
        <p className="billing-portal-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
