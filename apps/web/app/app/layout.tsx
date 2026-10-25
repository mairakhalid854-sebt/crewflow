import Link from 'next/link';

import type { Database } from '@crewflow/database';

import { logoutAction } from '../(auth)/actions';
import { requireTenantContext } from '../../lib/auth/tenant-context';
import { createClient } from '../../lib/supabase/server';

import './workspace.css';

type MembershipRole = Database['public']['Enums']['membership_role'];

const navItems: readonly {
  href: string;
  label: string;
  roles?: readonly MembershipRole[];
}[] = [
  { href: '/app', label: 'Overview' },
  { href: '/app/jobs', label: 'Jobs' },
  {
    href: '/app/invoices',
    label: 'Invoices',
    roles: ['owner', 'office'],
  },
  {
    href: '/app/dispatch',
    label: 'Dispatch',
    roles: ['owner', 'office'],
  },
  {
    href: '/app/customers',
    label: 'Customers',
    roles: ['owner', 'office'],
  },
  { href: '/app/services', label: 'Services' },
  {
    href: '/app/team',
    label: 'Team',
    roles: ['owner', 'office'],
  },
  {
    href: '/app/audit',
    label: 'Audit trail',
    roles: ['owner', 'office'],
  },
  {
    href: '/app/intake',
    label: 'Intake',
    roles: ['owner', 'office'],
  },
  {
    href: '/app/ai',
    label: 'AI operations',
    roles: ['owner', 'office'],
  },
  { href: '/app/profile', label: 'My profile' },
  {
    href: '/app/settings',
    label: 'Settings',
    roles: ['owner'],
  },
  {
    href: '/app/billing',
    label: 'CrewFlow billing',
    roles: ['owner'],
  },
];

export default async function AuthenticatedAppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const context = await requireTenantContext();
  const supabase = await createClient();
  const { data: accessMode, error: accessError } = await supabase.rpc(
    'get_current_tenant_access_mode',
  );
  if (accessError) throw new Error('Workspace access could not be verified.');
  const initials = context.userName
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return (
    <main className="authenticated-shell">
      <aside className="authenticated-sidebar" aria-label="Primary navigation">
        <Link className="workspace-brand" href="/app">
          <span aria-hidden="true">C</span>
          CrewFlow
        </Link>
        <nav>
          {navItems
            .filter((item) => !item.roles || item.roles.includes(context.role))
            .map((item) => (
              <Link href={item.href} key={item.href}>
                {item.label}
              </Link>
            ))}
        </nav>
        <div className="workspace-company">
          <span>Current workspace</span>
          <strong>{context.tenantName}</strong>
        </div>
      </aside>

      <section className="authenticated-workspace">
        <header className="workspace-topbar">
          <div>
            <span className="workspace-eyebrow">{context.role}</span>
            <strong>{context.userName}</strong>
          </div>
          <div className="workspace-account">
            <span className="workspace-avatar" aria-hidden="true">
              {initials || 'CF'}
            </span>
            <form action={logoutAction}>
              <button type="submit">Sign out</button>
            </form>
          </div>
        </header>
        {accessMode !== 'full' ? (
          <div
            className={`subscription-access-banner subscription-access-${accessMode}`}
            role="status"
          >
            <strong>
              {accessMode === 'read_only'
                ? 'Workspace is read-only'
                : 'Subscription needs attention'}
            </strong>
            <span>
              {accessMode === 'read_only'
                ? 'Your data remains available, but business records cannot be changed. Ask the owner to review CrewFlow billing.'
                : 'Core work remains available during the billing grace state. The owner should review CrewFlow billing.'}
            </span>
          </div>
        ) : null}
        {children}
      </section>
    </main>
  );
}
