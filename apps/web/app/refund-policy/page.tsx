import type { Metadata } from 'next';
import Link from 'next/link';

import { PublicSiteShell, supportEmail } from '../../components/public-site';
import '../privacy/privacy.css';

export const metadata: Metadata = {
  description:
    'How free trials, cancellations, and refunds work for CrewFlow360 subscriptions.',
  title: 'Refund policy | CrewFlow360',
};

export default function RefundPolicyPage() {
  return (
    <PublicSiteShell>
      <article className="privacy-card site-legal-card">
        <p className="privacy-kicker">REFUND POLICY</p>
        <h1>Trials, cancellations, and refunds</h1>
        <p className="privacy-effective">Effective November 4, 2026</p>

        <div className="privacy-summary">
          CrewFlow360 subscriptions are sold through our online reseller
          Paddle.com, which is the merchant of record for all orders and
          processes every payment and refund. This policy is part of our{' '}
          <Link href="/terms">Terms of Service</Link>.
        </div>

        <section>
          <h2>Free trial</h2>
          <p>
            New subscriptions include a 14-day free trial. You are not charged
            during the trial. If you cancel before the trial ends, you will not
            be charged at all.
          </p>
        </section>

        <section>
          <h2>Cancelling</h2>
          <p>
            You can cancel at any time from the billing page in your workspace.
            Cancellation takes effect at the end of the current billing period,
            and you keep access until then. You will not be charged again after
            you cancel.
          </p>
        </section>

        <section>
          <h2>Refunds</h2>
          <p>
            If you are not satisfied with your first paid subscription, you may
            request a full refund within 14 days of that first charge. Other
            refunds are at our discretion unless required by law, including any
            statutory cancellation rights that apply where you live.
          </p>
        </section>

        <section>
          <h2>How to request a refund</h2>
          <p>
            Email <a href={`mailto:${supportEmail}`}>{supportEmail}</a> with the
            email address on your account and your Paddle order number, or
            contact Paddle directly through the link on your receipt. Approved
            refunds are returned by Paddle to the original payment method.
          </p>
        </section>
      </article>
    </PublicSiteShell>
  );
}
