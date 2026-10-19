import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { createClient } from '../../../lib/supabase/server';

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

export default async function BillingPage() {
  const context = await requireTenantContext(['owner']);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_owner_billing_summary');

  if (error || !data?.[0]) {
    throw new Error('CrewFlow billing details could not be loaded.');
  }

  const billing = data[0];
  const isStub = billing.provider === 'stub';

  return (
    <div className="workspace-page billing-page">
      <header className="workspace-heading">
        <div>
          <p className="workspace-kicker">Owner controls</p>
          <h1>CrewFlow billing</h1>
          <p>
            Review the subscription entitlement for this workspace. Customer
            invoice payments remain separate and always go directly to your
            business.
          </p>
        </div>
        <span
          className={`status-badge billing-access-badge billing-access-${billing.access_mode}`}
        >
          {label(billing.access_mode)} access
        </span>
      </header>

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
          <strong>{label(billing.subscription_status)}</strong>
          <small>{isStub ? 'Local/staging provider' : 'Paddle sandbox'}</small>
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

      <section className="billing-safety-panel">
        <div aria-hidden="true">✓</div>
        <div>
          <h2>
            {isStub ? 'No real billing is active' : 'Sandbox billing only'}
          </h2>
          <p>
            {isStub
              ? 'This price-free development entitlement keeps CrewFlow test workflows available. It cannot create a checkout or charge a card.'
              : 'Verified Paddle sandbox events can update this entitlement, but no live Paddle provider exists in the application.'}
          </p>
          <p>
            Live plans, prices, trial/grace terms, seller approval, and legal
            wording still require an explicit owner decision before production
            billing can be enabled.
          </p>
        </div>
      </section>
    </div>
  );
}
