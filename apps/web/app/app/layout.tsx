import Link from 'next/link';

import type { Database } from '@crewflow/database';

import { logoutAction } from '../(auth)/actions';
import { requireTenantContext } from '../../lib/auth/tenant-context';

import './workspace.css';

type MembershipRole = Database['public']['Enums']['membership_role'];

const navItems: readonly {
  href: string;
  label: string;
  roles?: readonly MembershipRole[];
}[] = [
  { href: '/app', label: 'Overview' },
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
    href: '/app/settings',
    label: 'Settings',
    roles: ['owner'],
  },
];

export default async function AuthenticatedAppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const context = await requireTenantContext();
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
        {children}
      </section>
    </main>
  );
}
