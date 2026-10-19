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
        <p className="privacy-effective">Effective October 19, 2026</p>

        <div className="privacy-summary">
          CrewFlow is currently in controlled testing. This notice describes the
          information the service needs to operate and the choices available to
          workspace members and customers.
        </div>

        <section>
          <h2>Who is responsible for the information</h2>
          <p>
            Each service business controls the customer, job, and workforce
            information placed in its CrewFlow workspace. CrewFlow processes
            that information to provide the application. For questions about a
            specific job, quote, invoice, photo, signature, or customer record,
            contact the service business that created it.
          </p>
        </section>

        <section>
          <h2>Information we process</h2>
          <ul>
            <li>
              Account and workspace details, including names, email addresses,
              roles, business settings, and authentication records.
            </li>
            <li>
              Customer and job details, including contact information,
              addresses, schedules, services, notes, quotes, invoices, and
              payment-status records entered by the service business.
            </li>
            <li>
              Field-work content, including job photos, progress notes,
              completion records, and customer signatures and consent records.
            </li>
            <li>
              Device and operational data, including push-notification tokens,
              app installation identifiers, audit events, security logs, and
              basic diagnostic information.
            </li>
          </ul>
        </section>

        <section>
          <h2>Why we process it</h2>
          <p>
            We use information to authenticate users; isolate company
            workspaces; schedule, assign, and complete jobs; prepare and share
            business documents; deliver requested notifications; protect the
            service; investigate failures; and meet legal obligations. CrewFlow
            does not use workspace information for targeted advertising and does
            not sell personal information.
          </p>
        </section>

        <section>
          <h2>Sharing and service providers</h2>
          <p>
            Information is visible to authorized members of the relevant
            workspace and, where a business shares a secure link, to the
            intended customer. CrewFlow also uses infrastructure providers to
            host the web application, database, authentication, private files,
            and push notifications. Those providers process information only to
            deliver their services. We may disclose information when required by
            law or to protect users, the service, or others.
          </p>
        </section>

        <section>
          <h2>Device permissions</h2>
          <p>
            Camera and photo-library access is used only when a member chooses
            to add job photos. Notification permission is used to deliver
            selected operational alerts. Permissions can be changed in device
            settings, although doing so may disable those features.
          </p>
        </section>

        <section>
          <h2>Retention, security, and transfers</h2>
          <p>
            Information is retained while needed to provide the workspace,
            maintain required business and security records, resolve disputes,
            and meet legal obligations. CrewFlow uses access controls,
            encryption in transit, private file storage, and audit trails, but
            no system can guarantee absolute security. Infrastructure providers
            may process information in the United States and other locations
            where they operate.
          </p>
        </section>

        <section>
          <h2>Your choices and requests</h2>
          <p>
            Workspace members can change notification preferences in the app.
            Requests to access, correct, export, or delete customer or job
            information should first be sent to the service business that
            controls the workspace. Account and platform privacy requests can be
            sent through the support contact shown on the CrewFlow app-store
            listing. Identity and authority may be verified before a request is
            completed.
          </p>
        </section>

        <section>
          <h2>Children and changes</h2>
          <p>
            CrewFlow is a business service and is not directed to children under
            13. We may update this notice as the service changes. The effective
            date above will be updated when a revised notice is published.
          </p>
        </section>

        <footer>
          This notice is a pre-launch operational draft and must receive legal
          review before general availability.
        </footer>
      </article>
    </main>
  );
}
