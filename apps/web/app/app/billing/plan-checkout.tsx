'use client';

import { useRef, useState } from 'react';

import { initializePaddle, type Paddle } from '@paddle/paddle-js';

import {
  checkoutCustomData,
  type CheckoutPlan,
  type PaddleEnvironment,
} from './paddle-checkout';

interface PlanCheckoutProps {
  readonly clientToken: string;
  readonly environment: PaddleEnvironment;
  readonly plans: readonly CheckoutPlan[];
  readonly tenantId: string;
}

function formatPrice(plan: CheckoutPlan): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: plan.currencyCode,
    maximumFractionDigits: 0,
  }).format(plan.amountCents / 100);
}

function startLabel(plan: CheckoutPlan, isSandbox: boolean): string {
  if (isSandbox) return 'Start test checkout';
  return plan.trialDays > 0
    ? `Start ${plan.trialDays}-day free trial`
    : 'Subscribe';
}

export function PlanCheckout({
  clientToken,
  environment,
  plans,
  tenantId,
}: PlanCheckoutProps) {
  const paddleRef = useRef<Promise<Paddle | undefined> | null>(null);
  const [openingPlan, setOpeningPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isSandbox = environment === 'sandbox';

  async function openCheckout(plan: CheckoutPlan): Promise<void> {
    setError(null);
    setOpeningPlan(plan.code);

    try {
      paddleRef.current ??= initializePaddle({
        environment,
        token: clientToken,
      });
      const paddle = await paddleRef.current;
      if (!paddle) throw new Error('Paddle could not be initialized.');

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
      setError('Checkout could not be opened. Please try again.');
    } finally {
      setOpeningPlan(null);
    }
  }

  return (
    <section className="billing-plan-panel" aria-labelledby="checkout-plans">
      <div>
        <p className="workspace-kicker">
          {isSandbox ? 'Sandbox catalog' : 'Choose a plan'}
        </p>
        <h2 id="checkout-plans">
          {isSandbox
            ? 'Test a CrewFlow360 subscription'
            : 'Start your CrewFlow360 subscription'}
        </h2>
        <p>
          {isSandbox
            ? 'These checkouts use Paddle test mode. No real card is charged and no live subscription is created.'
            : 'Every plan includes every feature. You are not charged during the free trial and can cancel any time before it ends. Checkout is handled by Paddle, our merchant of record.'}
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
                ? `${plan.trialDays}-day ${isSandbox ? 'sandbox' : 'free'} trial`
                : 'No trial'}
            </small>
            <button
              className="primary-button"
              disabled={openingPlan !== null}
              onClick={() => void openCheckout(plan)}
              type="button"
            >
              {openingPlan === plan.code
                ? 'Opening…'
                : startLabel(plan, isSandbox)}
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
