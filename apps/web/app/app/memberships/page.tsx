import Link from 'next/link';

import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { createClient } from '../../../lib/supabase/server';
import {
  CancelMembershipForm,
  CreateDueVisitsButton,
  MembershipPlanForm,
} from './membership-forms';
import './memberships.css';

export const dynamic = 'force-dynamic';

const usd = new Intl.NumberFormat('en-US', {
  currency: 'USD',
  style: 'currency',
});

function money(cents: number): string {
  return usd.format(cents / 100);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

function localToday(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).format(new Date());
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export default async function MembershipsPage() {
  const context = await requireTenantContext(['owner', 'office']);
  const isOwner = context.role === 'owner';
  const supabase = await createClient();
  const today = localToday(context.timeZone);

  const [plansResult, membersResult, visitsResult, servicesResult] =
    await Promise.all([
      supabase
        .from('membership_plans')
        .select(
          'id, name, description, price_cents, billing_interval, visits_per_year, discount_percent, service_id, is_active',
        )
        .eq('tenant_id', context.tenantId)
        .order('name'),
      supabase
        .from('customer_memberships')
        .select(
          'id, customer_id, plan_name, price_cents, billing_interval, started_on, renews_on, next_visit_on, customers(first_name, last_name)',
        )
        .eq('tenant_id', context.tenantId)
        .eq('status', 'active')
        .order('next_visit_on'),
      supabase
        .from('membership_visits')
        .select(
          'id, due_on, job_id, jobs(title, status, scheduled_start_at, customers(first_name, last_name))',
        )
        .eq('tenant_id', context.tenantId)
        .order('due_on')
        .limit(100),
      supabase
        .from('services')
        .select('id, name')
        .eq('tenant_id', context.tenantId)
        .is('archived_at', null)
        .order('name'),
    ]);

  if (
    plansResult.error ||
    membersResult.error ||
    visitsResult.error ||
    servicesResult.error
  ) {
    throw new Error('Memberships could not be loaded.');
  }

  const plans = plansResult.data ?? [];
  const members = membersResult.data ?? [];
  const toSchedule = (visitsResult.data ?? []).filter(
    (visit) =>
      visit.jobs &&
      !visit.jobs.scheduled_start_at &&
      !['cancelled', 'completed', 'closed'].includes(visit.jobs.status),
  );
  const monthlyRevenue = members.reduce(
    (total, member) =>
      total +
      (member.billing_interval === 'yearly'
        ? Math.round(member.price_cents / 12)
        : member.price_cents),
    0,
  );
  const renewSoon = members.filter(
    (member) => member.renews_on <= addDays(today, 30),
  );
  const memberName = (
    person: { first_name: string; last_name: string } | null,
  ) => (person ? `${person.first_name} ${person.last_name}` : 'Customer');

  return (
    <div className="workspace-page resource-editor-page settings-page memberships-admin">
      <header className="workspace-heading">
        <div>
          <p className="workspace-kicker">Grow your business</p>
          <h1>Memberships</h1>
          <p>
            Maintenance plans bring steady monthly income and loyal customers.
            Visit jobs are created automatically 14 days before they are due.
          </p>
        </div>
        <CreateDueVisitsButton />
      </header>

      <section aria-label="Membership summary" className="membership-stats">
        <div>
          <span>Active members</span>
          <strong>{members.length}</strong>
        </div>
        <div>
          <span>Monthly recurring revenue</span>
          <strong>{money(monthlyRevenue)}</strong>
        </div>
        <div>
          <span>Visits to schedule</span>
          <strong>{toSchedule.length}</strong>
        </div>
        <div>
          <span>Renewals in 30 days</span>
          <strong>{renewSoon.length}</strong>
        </div>
      </section>

      <section
        className="settings-section"
        aria-labelledby="visits-to-schedule"
      >
        <div className="settings-section-heading">
          <h2 id="visits-to-schedule">Visits to schedule</h2>
          <p>
            Open the job, pick a time and technician, and the customer is
            notified as usual.
          </p>
        </div>
        {toSchedule.length === 0 ? (
          <p className="membership-muted">No membership visits are waiting.</p>
        ) : (
          <ul className="membership-list">
            {toSchedule.map((visit) => (
              <li key={visit.id}>
                <span>
                  <strong>{memberName(visit.jobs?.customers ?? null)}</strong>
                  <small>
                    {visit.jobs?.title} · due {formatDate(visit.due_on)}
                  </small>
                </span>
                <Link
                  className="secondary-button"
                  href={`/app/jobs/${visit.job_id}`}
                >
                  Schedule
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="settings-section" aria-labelledby="active-members">
        <div className="settings-section-heading">
          <h2 id="active-members">Members</h2>
          <p>
            Add customers to a plan from their customer page. Bill them with a
            normal invoice on each renewal date.
          </p>
        </div>
        {members.length === 0 ? (
          <div className="empty-state">
            <h2>No members yet</h2>
            <p>
              Open a customer in <Link href="/app/customers">Customers</Link>{' '}
              and choose <strong>Add to plan</strong>.
            </p>
          </div>
        ) : (
          <div className="resource-table-wrap">
            <table className="resource-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Plan</th>
                  <th>Price</th>
                  <th>Next visit</th>
                  <th>Renews</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <Link href={`/app/customers/${member.customer_id}`}>
                        {memberName(member.customers)}
                      </Link>
                    </td>
                    <td>{member.plan_name}</td>
                    <td>
                      {money(member.price_cents)}
                      {member.billing_interval === 'yearly'
                        ? ' / year'
                        : ' / month'}
                    </td>
                    <td>{formatDate(member.next_visit_on)}</td>
                    <td>{formatDate(member.renews_on)}</td>
                    <td>
                      <CancelMembershipForm membershipId={member.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isOwner ? (
        <section
          className="settings-section"
          aria-labelledby="membership-plans"
        >
          <div className="settings-section-heading">
            <h2 id="membership-plans">Plans</h2>
            <p>
              Changes apply to new members. Existing members keep the price and
              terms they joined with.
            </p>
          </div>
          <div className="membership-plans">
            {plans.map((plan) => (
              <details className="membership-plan" key={plan.id}>
                <summary>
                  <strong>{plan.name}</strong>
                  <span>
                    {money(plan.price_cents)}
                    {plan.billing_interval === 'yearly'
                      ? ' / year'
                      : ' / month'}{' '}
                    · {plan.visits_per_year} visit
                    {plan.visits_per_year === 1 ? '' : 's'} a year ·{' '}
                    {plan.discount_percent}% off
                    {plan.is_active ? '' : ' · closed to new members'}
                  </span>
                </summary>
                <MembershipPlanForm
                  plan={plan}
                  services={servicesResult.data ?? []}
                />
              </details>
            ))}
            <details className="membership-plan" open={plans.length === 0}>
              <summary>
                <strong>+ New plan</strong>
              </summary>
              <MembershipPlanForm services={servicesResult.data ?? []} />
            </details>
          </div>
        </section>
      ) : null}
    </div>
  );
}
