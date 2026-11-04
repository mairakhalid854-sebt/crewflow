import type { Metadata } from 'next';
import Link from 'next/link';

import { PublicSiteShell } from '../../components/public-site';
import {
  includedFeatures,
  publicPlans,
  trialDays,
} from '../../lib/billing/public-plans';

export const metadata: Metadata = {
  description:
    'CrewFlow360 monthly plans for field-service teams, each with a 14-day free trial.',
  title: 'Pricing | CrewFlow360',
};

export default function PricingPage() {
  return (
    <PublicSiteShell>
      <section className="site-section site-page-intro">
        <p className="site-kicker site-kicker-blue">PRICING</p>
        <h1>Plans that grow with your crew</h1>
        <p>
          Every plan includes every feature and a {trialDays}-day free trial.
          Pick the plan that fits your team size.
        </p>
      </section>

      <section aria-label="Plans" className="site-section site-plan-grid">
        {publicPlans.map((plan) => (
          <article className="site-plan" key={plan.code}>
            <h2>{plan.name}</h2>
            <p className="site-plan-description">{plan.description}</p>
            <p className="site-plan-price">
              <strong>${plan.monthlyPriceUsd}</strong>
              <span>/month</span>
            </p>
            <p className="site-plan-seats">
              Up to {plan.seatLimit} team members
            </p>
            <Link className="site-button" href="/signup">
              Start free trial
            </Link>
          </article>
        ))}
      </section>

      <section aria-labelledby="included-title" className="site-section">
        <div className="site-included">
          <h2 id="included-title">Included in every plan</h2>
          <ul>
            {includedFeatures.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="site-section site-fine-print">
        <p>
          Prices are in US dollars and billed monthly. Applicable sales tax or
          VAT is calculated at checkout. You are not charged during the{' '}
          {trialDays}-day trial, and you can cancel at any time. Our order
          process is conducted by our online reseller Paddle.com, which is the
          merchant of record for all orders. See the{' '}
          <Link href="/refund-policy">Refund Policy</Link> and{' '}
          <Link href="/terms">Terms of Service</Link>.
        </p>
      </section>
    </PublicSiteShell>
  );
}
