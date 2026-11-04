import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { createClient } from '../../../lib/supabase/server';

import { openBillingPortalAction } from './actions';
import {
  isCheckoutConfigured,
  paddleEnvironmentFromToken,
  paddleProviderFor,
  type CheckoutPlan,
} from './paddle-checkout';
import { PlanCheckout } from './plan-checkout';

export const dynamic = 'force-dynamic';

function label(value: string): string {
  return value.replaceAll('_', ' ');
}

function formatDate(value: string | null, timeZone: string): string {
  if (!value) return 'Not set';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeZone,
  }).format(new Date(value));
}

function formatLimit(value: number | null): string {
  return value === null ? 'Not configured' : value.toLocaleString('en-US');
}

function providerLabel(provider: string, planCode: string): string {
  if (provider === 'paddle') return 'Billed by Paddle';
  if (provider === 'paddle_sandbox') return 'Paddle sandbox';
  return planCode === 'development_stub'
    ? 'Free beta access'
    : 'No subscription yet';
}

interface BillingPageProps {
  readonly searchParams: Promise<{ checkout?: string; portal?: string }>;
}

export default async function BillingPage({ searchParams }: BillingPageProps) {
  const query = await searchParams;
  const context = await requireTenantContext(['owner']);
  const supabase = await createClient();
  const paddleClientToken = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
  const environment = paddleEnvironmentFromToken(paddleClientToken);
  const [{ data, error }, plansResult] = await Promise.all([
    supabase.rpc('get_owner_billing_summary'),
    environment
      ? supabase.rpc('list_owner_paddle_plans', {
          target_provider: paddleProviderFor(environment),
        })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (error || !data?.[0]) {
    throw new Error('CrewFlow360 billing details could not be loaded.');
  }

  const billing = data[0];
  const isStub = billing.provider === 'stub';
  const isSandbox = environment === 'sandbox';
  const requiresCheckout =
    billing.plan_code === 'checkout_required' ||
    (!isStub && billing.subscription_status === 'canceled');
  const plans: CheckoutPlan[] = (plansResult.data ?? []).map((plan) => ({
    amountCents: plan.amount_cents,
    billingInterval: plan.billing_interval,
    code: plan.code,
    currencyCode: plan.currency_code,
    displayName: plan.display_name,
    priceId: plan.provider_price_id,
    seatLimit: plan.seat_limit,
    trialDays: plan.trial_days,
  }));
  const checkoutConfigured =
    !plansResult.error && isCheckoutConfigured(paddleClientToken, plans);
  // Sandbox keeps test checkout open for any stub workspace so staging can
  // exercise the flow; live checkout appears only when a plan is required.
  const showCheckout = requiresCheckout || (isSandbox && isStub);

  return (
    <div className="workspace-page billing-page">
      <header className="workspace-heading">
        <div>
          <p className="workspace-kicker">Owner controls</p>
          <h1>CrewFlow360 billing</h1>
          <p>
            Review the subscription for this workspace. Customer invoice
            payments remain separate and always go directly to your business.
          </p>
        </div>
        <span
          className={`status-badge billing-access-badge billing-access-${billing.access_mode}`}
        >
          {label(billing.access_mode)} access
        </span>
      </header>

      {requiresCheckout ? (
        <p className="billing-checkout-required" role="status">
          {billing.plan_code === 'checkout_required'
            ? 'Choose a plan below to start your free trial and unlock your workspace.'
            : 'Your subscription has ended. Choose a plan to unlock your workspace again.'}
        </p>
      ) : null}

      <section
        className="billing-summary-grid"
        aria-label="Subscription summary"
      >
        <article className="billing-summary-card">
          <span>Plan</span>
          <strong>{billing.plan_name}</strong>
          <small>{billing.plan_code}</small>
        </article>
        <article className="billing-summary-card">
          <span>Status</span>
          <strong>
            {billing.plan_code === 'checkout_required'
              ? 'Not started'
              : label(billing.subscription_status)}
          </strong>
          <small>{providerLabel(billing.provider, billing.plan_code)}</small>
        </article>
        <article className="billing-summary-card">
          <span>Current period</span>
          <strong>
            {formatDate(billing.current_period_ends_at, context.timeZone)}
          </strong>
          <small>
            Starts{' '}
            {formatDate(billing.current_period_starts_at, context.timeZone)}
          </small>
        </article>
      </section>

      <section className="billing-detail-panel">
        <div>
          <p className="workspace-kicker">Configured entitlements</p>
          <h2>Workspace limits</h2>
        </div>
        <dl className="billing-detail-list">
          <div>
            <dt>Team seats</dt>
            <dd>{formatLimit(billing.seat_limit)}</dd>
          </div>
          <div>
            <dt>Monthly AI budget</dt>
            <dd>
              {billing.ai_monthly_budget_cents === null
                ? 'Not configured'
                : `$${(billing.ai_monthly_budget_cents / 100).toFixed(2)}`}
            </dd>
          </div>
          <div>
            <dt>Trial</dt>
            <dd>
              {billing.trial_days ? `${billing.trial_days} days` : 'None'}
            </dd>
          </div>
          <div>
            <dt>Renewal</dt>
            <dd>
              {billing.cancel_at_period_end
                ? 'Ends after current period'
                : billing.billing_interval
                  ? `Every ${billing.billing_interval}`
                  : 'Not configured'}
            </dd>
          </div>
        </dl>
      </section>

      {query.checkout === 'success' ? (
        <p className="billing-checkout-success" role="status">
          {isSandbox ? 'Test checkout completed.' : 'Checkout completed.'}{' '}
          Paddle is syncing the subscription; refresh this page in a few seconds
          if the status has not changed yet.
        </p>
      ) : null}

      {showCheckout &&
      checkoutConfigured &&
      environment &&
      paddleClientToken ? (
        <PlanCheckout
          clientToken={paddleClientToken}
          environment={environment}
          plans={plans}
          tenantId={context.tenantId}
        />
      ) : null}

      {showCheckout && !checkoutConfigured ? (
        <section className="billing-plan-panel">
          <div>
            <p className="workspace-kicker">Choose a plan</p>
            <h2>Checkout is being set up</h2>
            <p>
              Plans will appear here shortly. Contact support@crewflow360.com if
              this message does not go away.
            </p>
          </div>
        </section>
      ) : null}

      <section className="billing-portal-panel">
        <div>
          <p className="workspace-kicker">Subscription management</p>
          <h2>Billing portal</h2>
          <p>
            {isStub
              ? 'The billing portal becomes available after you start a subscription.'
              : 'Open Paddle’s secure portal to review invoices, update your payment method, or cancel your subscription.'}
          </p>
          {query.portal === 'unavailable' ? (
            <p className="billing-portal-error" role="alert">
              The billing portal is temporarily unavailable. Please try again.
            </p>
          ) : null}
        </div>
        {isStub ? (
          <button className="secondary-button" disabled type="button">
            Portal not available yet
          </button>
        ) : (
          <form action={openBillingPortalAction}>
            <button className="primary-button" type="submit">
              Open billing portal
            </button>
          </form>
        )}
      </section>

      <section className="billing-safety-panel">
        <div aria-hidden="true">✓</div>
        <div>
          <h2>
            {billing.provider === 'paddle_sandbox'
              ? 'Sandbox billing only'
              : 'Paddle is the merchant of record'}
          </h2>
          <p>
            {billing.provider === 'paddle_sandbox'
              ? 'Verified Paddle sandbox events update this test entitlement. No real card is charged.'
              : 'Paddle.com handles checkout, payment, invoices, and sales tax for CrewFlow360 subscriptions. CrewFlow360 never sees your full card details.'}
          </p>
          {billing.plan_code === 'development_stub' ? (
            <p>
              This workspace has free beta access and keeps full access at no
              charge.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
