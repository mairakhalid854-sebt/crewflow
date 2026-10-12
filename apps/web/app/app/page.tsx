import Link from 'next/link';

import { requireTenantContext } from '../../lib/auth/tenant-context';

export const dynamic = 'force-dynamic';

export default async function AuthenticatedDashboardPage() {
  const context = await requireTenantContext();

  return (
    <div className="workspace-page">
      <div className="workspace-heading">
        <div>
          <p className="workspace-kicker">Overview</p>
          <h1>Welcome back, {context.userName.split(' ')[0] ?? 'there'}</h1>
          <p>Build your operating data before scheduling the first job.</p>
        </div>
      </div>

      <section className="setup-grid" aria-label="Phase 1 setup">
        {context.role !== 'technician' ? (
          <Link className="setup-card" href="/app/customers">
            <span>01</span>
            <h2>Customers</h2>
            <p>
              Add customer contact details, addresses, notes, and preferences.
            </p>
          </Link>
        ) : null}
        <Link className="setup-card" href="/app/services">
          <span>02</span>
          <h2>Services</h2>
          <p>Configure prices, duration, and tax behavior for offered work.</p>
        </Link>
        <div className="setup-card setup-card-pending">
          <span>03</span>
          <h2>Team</h2>
          <p>Invitations and staff profiles are the next Phase 1 slice.</p>
        </div>
      </section>
    </div>
  );
}
