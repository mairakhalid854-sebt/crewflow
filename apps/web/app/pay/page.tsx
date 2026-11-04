import type { Metadata } from 'next';
import Link from 'next/link';

import { PublicSiteShell } from '../../components/public-site';
import '../privacy/privacy.css';

import { PayCheckout } from './pay-checkout';

export const metadata: Metadata = {
  description: 'Complete a CrewFlow360 subscription payment securely.',
  robots: { index: false },
  title: 'Complete payment | CrewFlow360',
};

// Paddle's default payment link. Paddle appends `?_ptxn=txn_...` for renewal
// recovery and invoice payments, and Paddle.js opens checkout for it.
export default function PayPage() {
  return (
    <PublicSiteShell>
      <article className="privacy-card site-legal-card">
        <p className="privacy-kicker">SECURE CHECKOUT</p>
        <h1>Complete your payment</h1>
        <div className="privacy-summary">
          <PayCheckout
            clientToken={process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN}
          />
        </div>
        <section>
          <p>
            Payments are processed by Paddle.com, the merchant of record for
            CrewFlow360 subscriptions. See the{' '}
            <Link href="/refund-policy">Refund Policy</Link> and{' '}
            <Link href="/terms">Terms of Service</Link>.
          </p>
        </section>
      </article>
    </PublicSiteShell>
  );
}
