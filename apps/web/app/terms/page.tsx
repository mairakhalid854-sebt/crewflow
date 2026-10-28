import type { Metadata } from 'next';
import Link from 'next/link';

import '../privacy/privacy.css';

export const metadata: Metadata = {
  description:
    'The terms that govern access to and use of the CrewFlow field-service platform.',
  title: 'Terms of Service | CrewFlow',
};

export default function TermsPage() {
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
        <p className="privacy-kicker">TERMS OF SERVICE</p>
        <h1>Terms for using CrewFlow</h1>
        <p className="privacy-effective">Effective October 28, 2026</p>

        <div className="privacy-summary">
          These terms are an agreement between CrewFlow (&quot;CrewFlow,&quot;
          &quot;we,&quot; or &quot;us&quot;) and the business that creates a
          CrewFlow account (&quot;Customer&quot; or &quot;you&quot;). By
          creating an account, accepting an invitation, or using the service,
          you agree to these terms and acknowledge the{' '}
          <Link href="/privacy">Privacy Notice</Link>.
        </div>

        <section>
          <h2>1. Eligibility and accounts</h2>
          <p>
            CrewFlow is for business use. You must be at least 18 years old and
            have authority to bind the business you register. You are
            responsible for the accuracy of your account information, for
            keeping credentials secure, for the members you invite and the roles
            you give them, and for all activity in your workspace. Tell us
            promptly if you suspect unauthorized access.
          </p>
        </section>

        <section>
          <h2>2. The service</h2>
          <p>
            CrewFlow provides tools to manage customers, jobs, schedules,
            quotes, invoices, work reports, team members, customer messages, and
            AI-assisted suggestions. We may improve, change, or retire features
            over time and will give reasonable notice before removing a feature
            you materially rely on. Features labeled beta or testing are
            provided as-is and may change or end.
          </p>
        </section>

        <section>
          <h2>3. Subscriptions, billing, and refunds</h2>
          <p>
            Paid plans are billed in advance on a recurring monthly or annual
            basis and renew automatically until cancelled. Our order process is
            conducted by our online reseller Paddle.com, which is the merchant
            of record for all subscription orders. Paddle handles checkout,
            payment, invoicing, sales tax, and billing inquiries, and its buyer
            terms also apply to your purchase. Prices and plan limits are shown
            before you buy; we will give at least 30 days&apos; notice of price
            changes, which take effect at your next renewal.
          </p>
          <p>
            New subscriptions include a 7-day free trial, limited to one trial
            per business. You will not be charged during the trial. A payment
            method may be required at checkout, and your paid subscription
            begins and is charged automatically when the trial ends unless you
            cancel before then.
          </p>
          <p>
            You can cancel at any time, and cancellation takes effect at the end
            of the current billing period. If you are not satisfied with your
            first paid subscription, you may request a full refund within 14
            days of that first charge. Other refunds are at our discretion
            unless required by law. If a payment fails, we may limit the
            workspace to read-only access after a grace period until payment is
            resolved.
          </p>
        </section>

        <section>
          <h2>4. Your data</h2>
          <p>
            You own the information you and your team put into CrewFlow
            (&quot;Customer Data&quot;). You grant us the rights needed to host,
            process, display, transmit, and back up Customer Data to provide,
            secure, and support the service, as described in the Privacy Notice.
            We do not sell Customer Data. You can export your data while your
            account is active and for a limited period after it ends, after
            which we delete it unless the law requires us to keep it.
          </p>
        </section>

        <section>
          <h2>5. Your responsibilities</h2>
          <ul>
            <li>
              You are responsible for having the rights, notices, and consents
              needed to collect and use your customers&apos; and team
              members&apos; information in CrewFlow.
            </li>
            <li>
              You are responsible for the messages you send through CrewFlow,
              including complying with email and marketing laws such as
              CAN-SPAM, honoring opt-outs, and keeping your business postal
              address current.
            </li>
            <li>
              Quotes, invoices, prices, taxes, work reports, and other documents
              you send are your own. CrewFlow does not collect or hold payments
              for your services; payments between you and your customers happen
              outside CrewFlow.
            </li>
            <li>
              You will review AI-assisted suggestions before approving them. AI
              output can be inaccurate or incomplete, and you are responsible
              for decisions and documents you approve.
            </li>
          </ul>
        </section>

        <section>
          <h2>6. Acceptable use</h2>
          <p>You will not, and will not let others:</p>
          <ul>
            <li>
              use CrewFlow for unlawful, fraudulent, deceptive, or harassing
              purposes, or to send unsolicited bulk messages;
            </li>
            <li>
              upload malware or content you have no right to share, or content
              that infringes others&apos; rights;
            </li>
            <li>
              attempt to access another business&apos;s workspace, probe or
              bypass security, or disrupt the service;
            </li>
            <li>
              reverse engineer, resell, or copy the service, or use it to build
              a competing product; or
            </li>
            <li>
              exceed reasonable usage limits or use automated means to overload
              the service.
            </li>
          </ul>
          <p>
            We may suspend access that threatens the service, other customers,
            or the law, and will notify you when practical.
          </p>
        </section>

        <section>
          <h2>7. Third-party services</h2>
          <p>
            CrewFlow relies on third-party providers, such as hosting, email,
            notification, AI, and payment providers listed in the Privacy
            Notice. Links or integrations you choose to use, such as external
            payment links on invoices, are governed by those third parties&apos;
            terms, and we are not responsible for them.
          </p>
        </section>

        <section>
          <h2>8. Intellectual property and feedback</h2>
          <p>
            CrewFlow and its software, design, and content are owned by us and
            our licensors. We grant you a limited, non-exclusive,
            non-transferable right to use the service during your subscription
            under these terms. If you give us feedback, we may use it without
            obligation to you.
          </p>
        </section>

        <section>
          <h2>9. Confidentiality and security</h2>
          <p>
            We protect Customer Data with reasonable administrative, technical,
            and physical safeguards, including workspace isolation, access
            controls, and encryption in transit, and we will notify you of a
            security incident affecting your Customer Data as required by law.
          </p>
        </section>

        <section>
          <h2>10. Term, suspension, and termination</h2>
          <p>
            These terms apply while you use CrewFlow. You may stop using the
            service and cancel at any time. We may suspend or end your access if
            you materially breach these terms and do not fix the breach within
            15 days of notice, immediately for serious misuse or legal risk, or
            with 30 days&apos; notice if we discontinue the service. Sections
            that by their nature should survive, including those on data,
            disclaimers, liability, and disputes, survive termination.
          </p>
        </section>

        <section>
          <h2>11. Disclaimers</h2>
          <p>
            Except as expressly stated in these terms, CrewFlow is provided
            &quot;as is&quot; and &quot;as available.&quot; To the fullest
            extent permitted by law, we disclaim all implied warranties,
            including merchantability, fitness for a particular purpose, and
            non-infringement, and we do not promise that the service will be
            uninterrupted or error-free or that AI output will be accurate.
          </p>
        </section>

        <section>
          <h2>12. Limitation of liability</h2>
          <p>
            To the fullest extent permitted by law, neither party will be liable
            for indirect, incidental, special, consequential, or punitive
            damages, or for lost profits, revenue, or data, and our total
            liability arising out of or relating to these terms or the service
            will not exceed the amount you paid us for the service in the 12
            months before the event giving rise to the claim. These limits do
            not apply where the law does not allow them.
          </p>
        </section>

        <section>
          <h2>13. Indemnity</h2>
          <p>
            You will defend and indemnify CrewFlow against third-party claims
            arising from your Customer Data, the messages and documents you
            send, or your violation of these terms or the law.
          </p>
        </section>

        <section>
          <h2>14. Governing law and disputes</h2>
          <p>
            These terms are governed by the laws of the State of Wyoming, USA,
            without regard to conflict-of-law rules. Before filing a claim, each
            party agrees to try to resolve the dispute informally for 30 days
            after written notice. Any unresolved dispute will be brought
            exclusively in the state or federal courts located in Wyoming, and
            both parties consent to their jurisdiction.
          </p>
        </section>

        <section>
          <h2>15. Changes and general terms</h2>
          <p>
            We may update these terms and will notify account owners of material
            changes at least 30 days before they take effect; continuing to use
            CrewFlow after that means you accept them. These terms, together
            with the Privacy Notice and any order details, are the entire
            agreement about the service. If any part is unenforceable, the rest
            remains in effect. You may not assign these terms without our
            consent; we may assign them in connection with a merger,
            acquisition, or sale of assets. Neither party is liable for delays
            caused by events beyond its reasonable control.
          </p>
        </section>

        <section>
          <h2>16. Contact</h2>
          <address className="privacy-contact">
            30 N Gould St, Ste N
            <br />
            Sheridan, WY 82801
            <br />
            United States
            <br />
            <a href="tel:+13074002050">+1 307-400-2050</a>
          </address>
        </section>
      </article>
    </main>
  );
}
