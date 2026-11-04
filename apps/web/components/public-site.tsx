import Link from 'next/link';
import type { ReactNode } from 'react';

import '../app/public-site.css';

export const supportEmail = 'support@crewflow360.com';

export function PublicSiteHeader() {
  return (
    <header className="site-header">
      <Link className="site-brand" href="/">
        <span aria-hidden="true">C</span>
        CrewFlow360
      </Link>
      <nav aria-label="Main" className="site-nav">
        <Link href="/pricing">Pricing</Link>
        <Link href="/login">Sign in</Link>
        <Link className="site-button site-button-small" href="/signup">
          Start free trial
        </Link>
      </nav>
    </header>
  );
}

export function PublicSiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div>
          <p className="site-footer-brand">CrewFlow360</p>
          <address>
            30 N Gould St, Ste N, Sheridan, WY 82801, United States
            <br />
            <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
            {' · '}
            <a href="tel:+13074002050">+1 307-400-2050</a>
          </address>
        </div>
        <nav aria-label="Legal" className="site-footer-links">
          <Link href="/pricing">Pricing</Link>
          <Link href="/terms">Terms of Service</Link>
          <Link href="/privacy">Privacy Notice</Link>
          <Link href="/refund-policy">Refund Policy</Link>
        </nav>
      </div>
    </footer>
  );
}

export function PublicSiteShell({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <div className="site-shell">
      <PublicSiteHeader />
      <main>{children}</main>
      <PublicSiteFooter />
    </div>
  );
}
