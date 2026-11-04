import type { Metadata } from 'next';
import Link from 'next/link';

import { PublicSiteShell } from '../components/public-site';
import { publicPlans, trialDays } from '../lib/billing/public-plans';

export const metadata: Metadata = {
  description:
    'CrewFlow360 is field-service software for managing customers, jobs, schedules, quotes, invoices, and crews in one workspace.',
  title: 'CrewFlow360 | Field service software for crews',
};

const features = [
  {
    body: 'Keep every customer, address, and past job in one place so anyone on the team can pick up the conversation.',
    title: 'Customers',
  },
  {
    body: 'Create jobs, assign the right technician by skill and availability, and see the whole day on the dispatch board.',
    title: 'Jobs and dispatch',
  },
  {
    body: 'Send a quote by email. Your customer reviews and approves it online, and the job moves forward.',
    title: 'Quotes',
  },
  {
    body: 'Turn finished work into invoices and work reports your customers can open from a secure link.',
    title: 'Invoices and reports',
  },
  {
    body: 'Invite your crew, set roles and skills, and track time off so schedules stay realistic.',
    title: 'Team',
  },
  {
    body: 'Add an intake form to your website so new service requests arrive ready to schedule.',
    title: 'Online requests',
  },
] as const;

const lowestPrice = Math.min(
  ...publicPlans.map((plan) => plan.monthlyPriceUsd),
);

export default function HomePage() {
  return (
    <PublicSiteShell>
      <section className="site-hero">
        <div className="site-hero-copy">
          <p className="site-kicker">FIELD SERVICE, IN FLOW</p>
          <h1>Give your crew a clearer day.</h1>
          <p>
            CrewFlow360 is one workspace for service businesses to manage
            customers, jobs, schedules, quotes, invoices, and the people doing
            the work in the field.
          </p>
          <div className="site-hero-actions">
            <Link className="site-button" href="/signup">
              Start {trialDays}-day free trial
            </Link>
            <Link className="site-button site-button-ghost" href="/pricing">
              See pricing
            </Link>
          </div>
          <p className="site-hero-note">
            Plans from ${lowestPrice}/month. No charge during the trial.
          </p>
        </div>
      </section>

      <section aria-labelledby="features-title" className="site-section">
        <p className="site-kicker site-kicker-blue">WHAT YOU GET</p>
        <h2 id="features-title">Everything from first call to final invoice</h2>
        <div className="site-feature-grid">
          {features.map((feature) => (
            <article className="site-feature" key={feature.title}>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="site-section site-cta">
        <h2>Simple monthly plans</h2>
        <p>
          Every plan includes every feature. Choose by team size, starting at $
          {lowestPrice}/month.
        </p>
        <Link className="site-button" href="/pricing">
          Compare plans
        </Link>
      </section>
    </PublicSiteShell>
  );
}
