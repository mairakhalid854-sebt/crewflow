import Link from 'next/link';
import type { ReactNode } from 'react';

import './auth.css';

export default function AuthLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <main className="auth-shell">
      <section
        className="auth-story"
        aria-label="CrewFlow product introduction"
      >
        <Link className="auth-brand" href="/">
          <span className="brand-mark">C</span>
          CrewFlow
        </Link>
        <div className="auth-story-copy">
          <p className="auth-kicker">FIELD SERVICE, IN FLOW</p>
          <h1>Give your crew a clearer day.</h1>
          <p>
            One trusted workspace for customers, jobs, schedules, and the work
            happening in the field.
          </p>
          <div className="auth-proof">
            <span>✓</span>
            <div>
              <strong>Tenant-isolated by design</strong>
              <small>Your company data stays in your company.</small>
            </div>
          </div>
          <div className="auth-proof">
            <span>✓</span>
            <div>
              <strong>Human-controlled automation</strong>
              <small>Sensitive actions always stay reviewable.</small>
            </div>
          </div>
        </div>
        <p className="auth-legal">
          CrewFlow handles SaaS access—not your customers’ service payments.
        </p>
      </section>
      <section className="auth-card-wrap">{children}</section>
    </main>
  );
}
