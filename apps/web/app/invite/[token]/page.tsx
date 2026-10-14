import Link from 'next/link';

import { createClient } from '../../../lib/supabase/server';
import { AcceptInvitationForm } from './accept-invitation-form';
import './styles.css';

const tokenPattern = /^[0-9a-f]{64}$/;

export const dynamic = 'force-dynamic';

export default async function InvitationPage({
  params,
}: Readonly<{ params: Promise<{ token: string }> }>) {
  const { token } = await params;
  const validTokenShape = tokenPattern.test(token);
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email =
    typeof data?.claims?.email === 'string' ? data.claims.email : null;
  const nextPath = `/invite/${token}`;

  return (
    <main className="invite-shell">
      <section className="invite-card">
        <Link className="invite-brand" href="/">
          <span>C</span>
          CrewFlow
        </Link>
        <p className="invite-kicker">TEAM INVITATION</p>
        <h1>Join your crew’s workspace</h1>
        <p className="invite-copy">
          Use the exact email address that received this link. New team members
          choose their own password before accepting. The invitation is
          single-use and expires automatically.
        </p>

        {!validTokenShape ? (
          <p className="invite-error" role="alert">
            This invitation link is invalid.
          </p>
        ) : email ? (
          <div className="invite-actions">
            <p>
              Signed in as <strong>{email}</strong>
            </p>
            <AcceptInvitationForm token={token} />
            <Link href="/login">Use a different account</Link>
          </div>
        ) : (
          <div className="invite-actions">
            <Link
              className="invite-primary"
              href={`/login?next=${encodeURIComponent(nextPath)}`}
            >
              Sign in to accept
            </Link>
            <Link href={`/signup?next=${encodeURIComponent(nextPath)}`}>
              New to CrewFlow? Choose a password and create an account
            </Link>
          </div>
        )}

        <p className="invite-security">
          CrewFlow checks both your verified email and the secure invitation
          token before granting access.
        </p>
      </section>
    </main>
  );
}
