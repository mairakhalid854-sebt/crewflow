import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { formatUsd } from '../../../lib/quotes/public-quote';
import { createClient } from '../../../lib/supabase/server';

import { MarketPriceForm, ProfitSettingsForm } from './profit-forms';

export const dynamic = 'force-dynamic';

const flagText: Readonly<Record<string, string>> = {
  above_market: 'Priced above the market range you entered',
  below_cost: 'Losing money: average earnings are below labor cost',
  below_market: 'Priced below the market range you entered',
  below_target: 'Profitable, but below your target margin',
  not_enough_data: 'Needs at least 3 timed jobs for reliable numbers',
  takes_longer: 'Jobs take over 25% longer than planned',
};

function minutesLabel(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function money(cents: number | null): string {
  return cents === null ? '—' : formatUsd(cents);
}

function dollarsInput(cents: number | null): string {
  return cents === null ? '' : (cents / 100).toFixed(2);
}

export default async function ProfitGuardPage() {
  const context = await requireTenantContext(['owner']);
  const supabase = await createClient();
  const [reportResult, settingsResult] = await Promise.all([
    supabase.rpc('get_service_profit_report', {
      target_days: 90,
      target_tenant_id: context.tenantId,
    }),
    supabase
      .from('tenant_settings')
      .select('profit_labor_cost_cents_per_hour, profit_target_margin_bps')
      .eq('tenant_id', context.tenantId)
      .single(),
  ]);

  if (reportResult.error || settingsResult.error) {
    throw new Error('Profit Guard could not be loaded.');
  }

  const rows = reportResult.data ?? [];
  const laborCost = settingsResult.data.profit_labor_cost_cents_per_hour;
  const targetMargin = settingsResult.data.profit_target_margin_bps / 100;
  const atRisk = rows.filter((row) =>
    row.flags.some((flag) =>
      ['below_cost', 'below_target', 'takes_longer'].includes(flag),
    ),
  ).length;

  return (
    <div className="workspace-page profit-page">
      <header className="workspace-heading">
        <div>
          <p className="workspace-kicker">Profit Guard</p>
          <h1>Is every service making money?</h1>
          <p>
            Based on jobs completed in the last 90 days. Time is measured from
            when the technician started the job to when they completed it.
          </p>
        </div>
      </header>

      <section className="profit-panel" aria-labelledby="profit-costs">
        <h2 id="profit-costs">Your costs</h2>
        {laborCost === null ? (
          <p className="profit-hint">
            Add your labor cost per hour to see profit, margin, and suggested
            prices.
          </p>
        ) : null}
        <ProfitSettingsForm
          laborCostDollars={dollarsInput(laborCost)}
          targetMarginPercent={targetMargin}
        />
      </section>

      <p className="profit-summary" role="status">
        {rows.length === 0
          ? 'Add services to start tracking profit.'
          : atRisk === 0
            ? 'No service needs attention right now.'
            : `${atRisk} service(s) need attention.`}
      </p>

      <div className="profit-list">
        {rows.map((row) => (
          <article className="profit-card" key={row.service_id}>
            <header>
              <h2>{row.service_name}</h2>
              <span>
                Your price <strong>{formatUsd(row.list_price_cents)}</strong>
              </span>
            </header>

            <dl className="profit-facts">
              <div>
                <dt>Completed jobs</dt>
                <dd>
                  {row.completed_jobs}
                  {row.measured_jobs !== row.completed_jobs
                    ? ` (${row.measured_jobs} timed)`
                    : ''}
                </dd>
              </div>
              <div>
                <dt>Planned time</dt>
                <dd>{minutesLabel(row.planned_minutes)}</dd>
              </div>
              <div>
                <dt>Actual time (median)</dt>
                <dd>{minutesLabel(row.median_minutes)}</dd>
              </div>
              <div>
                <dt>Average earned</dt>
                <dd>{money(row.average_revenue_cents)}</dd>
              </div>
              <div>
                <dt>Earned per hour</dt>
                <dd>{money(row.revenue_per_hour_cents)}</dd>
              </div>
              <div>
                <dt>Labor cost per job</dt>
                <dd>{money(row.cost_per_job_cents)}</dd>
              </div>
              <div>
                <dt>Margin</dt>
                <dd>
                  {row.margin_bps === null
                    ? '—'
                    : `${(row.margin_bps / 100).toFixed(0)}%`}
                </dd>
              </div>
            </dl>

            {row.flags.length ? (
              <ul className="profit-flags">
                {row.flags.map((flag) => (
                  <li data-flag={flag} key={flag}>
                    {flagText[flag] ?? flag}
                  </li>
                ))}
              </ul>
            ) : null}

            {row.suggested_price_cents !== null ? (
              <p className="profit-suggestion">
                To reach your {targetMargin}% target at the measured time,
                charge about{' '}
                <strong>{formatUsd(row.suggested_price_cents)}</strong>. This
                uses only your own labor cost and job times.
              </p>
            ) : null}

            <div className="profit-market">
              {row.market_price_low_cents !== null &&
              row.market_price_high_cents !== null ? (
                <p>
                  Market range you entered:{' '}
                  <strong>
                    {formatUsd(row.market_price_low_cents)} –{' '}
                    {formatUsd(row.market_price_high_cents)}
                  </strong>{' '}
                  · Source: {row.market_price_source} · Checked{' '}
                  {row.market_price_checked_on}
                </p>
              ) : (
                <p>
                  No market price yet. CrewFlow360 does not guess competitor
                  prices; add what you found and where.
                </p>
              )}
              <details>
                <summary>
                  {row.market_price_low_cents !== null
                    ? 'Update market price'
                    : 'Add market price'}
                </summary>
                <MarketPriceForm
                  checkedOn={row.market_price_checked_on ?? ''}
                  high={dollarsInput(row.market_price_high_cents)}
                  low={dollarsInput(row.market_price_low_cents)}
                  serviceId={row.service_id}
                  source={row.market_price_source ?? ''}
                />
              </details>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
