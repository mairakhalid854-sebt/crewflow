import { createClient } from '../../../lib/supabase/server';
import { EnrollMembershipForm } from './membership-forms';
import './memberships.css';

const usd = new Intl.NumberFormat('en-US', {
  currency: 'USD',
  style: 'currency',
});

function localToday(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).format(new Date());
}

/** Membership card on the customer page: current plans and "Add to plan". */
export async function CustomerMembershipCard({
  customerId,
  tenantId,
  timeZone,
}: Readonly<{ customerId: string; tenantId: string; timeZone: string }>) {
  const supabase = await createClient();
  const [membershipsResult, plansResult] = await Promise.all([
    supabase
      .from('customer_memberships')
      .select(
        'id, plan_name, price_cents, billing_interval, discount_percent, next_visit_on, renews_on',
      )
      .eq('customer_id', customerId)
      .eq('status', 'active'),
    supabase
      .from('membership_plans')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('name'),
  ]);
  if (membershipsResult.error || plansResult.error) return null;
  const memberships = membershipsResult.data ?? [];

  return (
    <section className="team-panel membership-card">
      <div className="team-panel-heading">
        <div>
          <h2>Membership</h2>
          <p>
            {memberships.length === 0
              ? 'Not on a maintenance plan yet.'
              : 'Member discount applies to other work. Visit jobs are created automatically.'}
          </p>
        </div>
      </div>
      {memberships.length > 0 ? (
        <ul className="membership-current">
          {memberships.map((membership) => (
            <li key={membership.id}>
              <strong>{membership.plan_name}</strong> ·{' '}
              {usd.format(membership.price_cents / 100)}
              {membership.billing_interval === 'yearly'
                ? ' / year'
                : ' / month'}{' '}
              · {membership.discount_percent}% off · next visit{' '}
              {membership.next_visit_on} · renews {membership.renews_on}
            </li>
          ))}
        </ul>
      ) : null}
      <EnrollMembershipForm
        customerId={customerId}
        plans={plansResult.data ?? []}
        today={localToday(timeZone)}
      />
    </section>
  );
}
