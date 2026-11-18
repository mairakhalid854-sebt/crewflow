import Link from 'next/link';

import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { createClient } from '../../../lib/supabase/server';
import { ReferralDecision, ReferralProgramForm } from './referral-forms';
import './referrals.css';

export const dynamic = 'force-dynamic';

const usd = new Intl.NumberFormat('en-US', {
  currency: 'USD',
  style: 'currency',
});

function money(cents: number): string {
  return usd.format(cents / 100);
}

const statusLabels: Record<string, string> = {
  pending: 'Waiting for the job',
  qualified: 'Ready to reward',
  rewarded: 'Rewarded',
  void: 'Not eligible',
};

export default async function ReferralsPage() {
  const context = await requireTenantContext(['owner', 'office']);
  const isOwner = context.role === 'owner';
  const supabase = await createClient();

  const [programResult, referralsResult, pageResult] = await Promise.all([
    supabase
      .from('referral_programs')
      .select(
        'enabled, referrer_reward_cents, friend_reward_cents, reward_note',
      )
      .eq('tenant_id', context.tenantId)
      .maybeSingle(),
    supabase
      .from('referrals')
      .select(
        'id, job_id, status, referrer_reward_cents, friend_reward_cents, created_at, qualified_at, rewarded_at, void_reason, referrer:customers!referrals_referrer_fk(id, first_name, last_name), friend:customers!referrals_referred_fk(id, first_name, last_name)',
      )
      .eq('tenant_id', context.tenantId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('booking_pages')
      .select('enabled')
      .eq('tenant_id', context.tenantId)
      .maybeSingle(),
  ]);

  if (programResult.error || referralsResult.error || pageResult.error) {
    throw new Error('Referrals could not be loaded.');
  }

  const program = programResult.data;
  const referrals = referralsResult.data ?? [];
  const toReward = referrals.filter((item) => item.status === 'qualified');
  const waiting = referrals.filter((item) => item.status === 'pending');
  const history = referrals.filter(
    (item) => item.status === 'rewarded' || item.status === 'void',
  );
  const completed = referrals.filter(
    (item) => item.status === 'qualified' || item.status === 'rewarded',
  ).length;
  const owed = toReward.reduce(
    (total, item) =>
      total + item.referrer_reward_cents + item.friend_reward_cents,
    0,
  );
  const name = (person: { first_name: string; last_name: string } | null) =>
    person ? `${person.first_name} ${person.last_name}` : 'Customer';

  return (
    <div className="workspace-page resource-editor-page settings-page referrals-admin">
      <header className="workspace-heading">
        <div>
          <p className="workspace-kicker">Grow your business</p>
          <h1>Referrals</h1>
          <p>
            Happy customers bring new ones. Give each customer a link, and
            reward both people when the friend&apos;s job is done.
          </p>
        </div>
      </header>

      {!pageResult.data?.enabled ? (
        <p className="form-message-error" role="note">
          Referral links open your booking page, which is off. Turn it on in{' '}
          <Link href="/app/booking">Online booking</Link>.
        </p>
      ) : null}

      <section aria-label="Referral summary" className="referral-stats">
        <div>
          <span>Referred bookings</span>
          <strong>{referrals.length}</strong>
        </div>
        <div>
          <span>Completed jobs from referrals</span>
          <strong>{completed}</strong>
        </div>
        <div>
          <span>Rewards to give</span>
          <strong>{money(owed)}</strong>
        </div>
      </section>

      <section
        className="settings-section"
        aria-labelledby="referrals-to-reward"
      >
        <div className="settings-section-heading">
          <h2 id="referrals-to-reward">Ready to reward ({toReward.length})</h2>
          <p>
            The friend&apos;s job is completed. Give both rewards, then mark it.
          </p>
        </div>
        {toReward.length === 0 ? (
          <div className="empty-state">
            <h2>Nothing to reward right now</h2>
            <p>Referrals move here when the friend&apos;s job is completed.</p>
          </div>
        ) : (
          <ul className="referral-list">
            {toReward.map((item) => (
              <li className="referral-item" key={item.id}>
                <div>
                  <strong>
                    {name(item.referrer)} → {name(item.friend)}
                  </strong>
                  <span>
                    {money(item.referrer_reward_cents)} to {name(item.referrer)}
                    {' · '}
                    {money(item.friend_reward_cents)} to {name(item.friend)}
                  </span>
                  <Link href={`/app/jobs/${item.job_id}`}>Open job</Link>
                </div>
                <ReferralDecision canReward referralId={item.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="settings-section" aria-labelledby="referrals-waiting">
        <div className="settings-section-heading">
          <h2 id="referrals-waiting">Waiting for the job ({waiting.length})</h2>
          <p>
            The friend booked; the reward unlocks when the job is completed.
          </p>
        </div>
        {waiting.length === 0 ? (
          <p className="referral-muted">No open referrals.</p>
        ) : (
          <ul className="referral-list">
            {waiting.map((item) => (
              <li className="referral-item" key={item.id}>
                <div>
                  <strong>
                    {name(item.referrer)} → {name(item.friend)}
                  </strong>
                  <Link href={`/app/jobs/${item.job_id}`}>Open job</Link>
                </div>
                <ReferralDecision canReward={false} referralId={item.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {isOwner ? <ReferralProgramForm program={program} /> : null}

      <section className="settings-section" aria-labelledby="referrals-share">
        <div className="settings-section-heading">
          <h2 id="referrals-share">How customers get their link</h2>
        </div>
        <ul className="referral-how">
          <li>
            Open a customer in <Link href="/app/customers">Customers</Link> and
            choose <strong>Get referral link</strong>, then text or email it.
          </li>
          <li>
            Customers also see their link on the work report you send after a
            completed job.
          </li>
          <li>
            Friends see who referred them and their reward on the booking page.
          </li>
        </ul>
      </section>

      {history.length > 0 ? (
        <section
          className="settings-section"
          aria-labelledby="referrals-history"
        >
          <div className="settings-section-heading">
            <h2 id="referrals-history">History</h2>
          </div>
          <div className="resource-table-wrap">
            <table className="resource-table">
              <thead>
                <tr>
                  <th>Referred by</th>
                  <th>New customer</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item.id}>
                    <td>{name(item.referrer)}</td>
                    <td>
                      <Link href={`/app/jobs/${item.job_id}`}>
                        {name(item.friend)}
                      </Link>
                    </td>
                    <td>
                      {statusLabels[item.status] ?? item.status}
                      {item.void_reason ? ` (${item.void_reason})` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
