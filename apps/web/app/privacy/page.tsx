import type { Metadata } from 'next';
import Link from 'next/link';

import './privacy.css';

export const metadata: Metadata = {
  description:
    'How CrewFlow handles account, workspace, job, device, and field-service information.',
  title: 'Privacy notice | CrewFlow',
};

export default function PrivacyPage() {
  return (
    <main className="privacy-shell">
      <header className="privacy-header">
        <Link className="privacy-brand" href="/login">
          <span aria-hidden="true">C</span>
          CrewFlow
        </Link>
        <Link className="privacy-login" href="/login">
          Sign in
        </Link>
      </header>

      <article className="privacy-card">
        <p className="privacy-kicker">PRIVACY NOTICE</p>
        <h1>How CrewFlow handles information</h1>
        <p className="privacy-effective">Effective October 28, 2026</p>

        <div className="privacy-summary">
          CrewFlow is software that field-service businesses use to manage
          customers, jobs, schedules, quotes, invoices, and their crews. This
          notice explains what information the service processes, why, who
          receives it, and the choices available to businesses, their team
          members, and their customers.
        </div>

        <section>
          <h2>Who is responsible for the information</h2>
          <p>
            Each service business that uses CrewFlow controls the customer, job,
            and workforce information placed in its workspace and decides how it
            is used. For that information, CrewFlow acts as a service provider
            that processes it on the business&apos;s behalf and under its
            instructions. For questions about a specific job, quote, invoice,
            photo, signature, or customer record, contact the service business
            that created it. CrewFlow is responsible for account, billing,
            security, and operational information it collects to run the
            service.
          </p>
        </section>

        <section>
          <h2>Information we process</h2>
          <ul>
            <li>
              Account and workspace details: names, email addresses, roles,
              business profile and settings, and authentication records.
            </li>
            <li>
              Customer and job details entered by the business: contact
              information, addresses, schedules, services, notes, quotes,
              invoices, payment-status records, and communication preferences.
            </li>
            <li>
              Field-work content: job photos, progress notes, completion
              records, customer signatures, and consent records.
            </li>
            <li>
              Conversations a customer has with a business through the CrewFlow
              booking chat, and documents a business uploads to its knowledge
              library.
            </li>
            <li>
              Subscription details for the business account, such as plan,
              status, and billing history. Card and bank details are collected
              by our payment reseller, not stored by CrewFlow.
            </li>
            <li>
              Device and operational data: push-notification tokens, app
              installation identifiers, audit events, security logs, and basic
              diagnostic information.
            </li>
          </ul>
        </section>

        <section>
          <h2>How we use it</h2>
          <p>
            We use information to authenticate users; keep each business&apos;s
            workspace separate; schedule, assign, and complete jobs; prepare and
            share business documents; send the emails and notifications a
            business requests; provide AI-assisted features; manage
            subscriptions; protect and troubleshoot the service; and meet legal
            obligations. CrewFlow does not sell personal information, does not
            share it for cross-context behavioral advertising, and does not use
            workspace information for advertising.
          </p>
        </section>

        <section>
          <h2>AI-assisted features</h2>
          <p>
            Some features, such as the booking chat, scheduling suggestions, and
            draft work reports, invoices, and follow-ups, send the relevant
            workspace information to an AI model provider to generate a
            proposal. A team member reviews proposals before anything is saved,
            sent, scheduled, or charged. Under our provider&apos;s API terms,
            submitted data is not used to train its models by default. AI output
            can be wrong; businesses remain responsible for what they approve.
          </p>
        </section>

        <section>
          <h2>Emails and your choices</h2>
          <p>
            Businesses use CrewFlow to send service messages, such as
            invitations, quotes, invoices, work reports, and payment reminders,
            and, where a customer has agreed, review requests. Every review
            request includes an unsubscribe link that stops further marketing
            email from that business; service messages about active jobs and
            invoices continue. If an email address bounces or is reported as
            spam, CrewFlow stops sending to it. Each business is responsible for
            obtaining any consent its messages require.
          </p>
        </section>

        <section>
          <h2>Service providers and sharing</h2>
          <p>
            Information is visible to authorized members of the relevant
            workspace and, when a business shares a secure link, to the intended
            recipient. CrewFlow uses these service providers, which may process
            information only to provide their services to us:
          </p>
          <ul>
            <li>
              Supabase for the database, authentication, and file storage.
            </li>
            <li>Vercel for hosting the web application.</li>
            <li>OpenAI for AI-assisted features.</li>
            <li>Resend for delivering email.</li>
            <li>Expo for delivering mobile push notifications.</li>
            <li>
              Paddle, our reseller and merchant of record, for subscription
              checkout, payments, invoicing, and sales tax.
            </li>
          </ul>
          <p>
            We may also disclose information when required by law, to protect
            the rights and safety of users and others, or as part of a merger,
            acquisition, or sale of assets, in which case this notice will
            continue to apply to the information transferred.
          </p>
        </section>

        <section>
          <h2>Cookies</h2>
          <p>
            CrewFlow uses only the cookies needed to keep you signed in and to
            secure your session. We do not use advertising or third-party
            analytics cookies.
          </p>
        </section>

        <section>
          <h2>Device permissions</h2>
          <p>
            Camera and photo-library access is used only when a team member
            chooses to add job photos. Notification permission is used to
            deliver selected operational alerts. Permissions can be changed in
            device settings, although doing so may disable those features.
          </p>
        </section>

        <section>
          <h2>Retention and security</h2>
          <p>
            Workspace information is kept while the business&apos;s account is
            active and for a limited period afterward so it can be exported or
            restored, then deleted unless the business asks otherwise or we must
            keep it to meet legal, tax, security, or dispute-resolution
            obligations. Backups are kept for a limited period and then
            overwritten. CrewFlow uses access controls, workspace isolation,
            encryption in transit, private file storage, malware scanning of
            uploaded documents, and audit trails, but no system can guarantee
            absolute security. If a security incident affects your personal
            information, we will notify affected businesses and individuals as
            required by law.
          </p>
        </section>

        <section>
          <h2>International processing</h2>
          <p>
            CrewFlow and its service providers may process information in the
            United States and other countries where they operate. We take steps
            to keep information protected wherever it is processed.
          </p>
        </section>

        <section>
          <h2>Your rights and requests</h2>
          <p>
            Depending on where you live, including several U.S. states, you may
            have the right to know what personal information is processed about
            you, to obtain a copy, to correct it, to delete it, and to opt out
            of certain uses. Requests about customer or job information should
            be sent to the service business that controls the workspace; we will
            help that business respond. Account and platform requests can be
            sent to CrewFlow using the contact details below. We may need to
            verify your identity and authority before completing a request, and
            we will not discriminate against you for exercising your rights.
            Team members can change notification preferences in the app.
          </p>
        </section>

        <section>
          <h2>Children</h2>
          <p>
            CrewFlow is a business service and is not directed to children under
            13. We do not knowingly collect personal information from children.
          </p>
        </section>

        <section>
          <h2>Changes to this notice</h2>
          <p>
            We may update this notice as the service changes. The effective date
            above shows when it was last revised, and we will notify account
            owners of material changes.
          </p>
        </section>

        <section>
          <h2>Contact CrewFlow</h2>
          <address className="privacy-contact">
            30 N Gould St, Ste N
            <br />
            Sheridan, WY 82801
            <br />
            United States
            <br />
            <a href="tel:+13074002050">+1 307-400-2050</a>
          </address>
          <p className="privacy-related">
            See also the <Link href="/terms">Terms of Service</Link>.
          </p>
        </section>
      </article>
    </main>
  );
}
