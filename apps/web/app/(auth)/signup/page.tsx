import { SignupForm } from '../auth-forms';
import { safeNextPath } from '../../../lib/auth/safe-next-path';

export default async function SignupPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ next?: string | string[] }>;
}>) {
  const nextPath = safeNextPath((await searchParams).next);
  const joiningTeam = nextPath.startsWith('/invite/');

  return (
    <div className="auth-card">
      <p className="step-label">
        {joiningTeam ? 'TEAM INVITATION' : 'OWNER ACCOUNT'}
      </p>
      <h2>
        {joiningTeam
          ? 'Create your CrewFlow account'
          : 'Start your CrewFlow workspace'}
      </h2>
      <p className="auth-intro">
        Your email must be verified before company setup.
      </p>
      <SignupForm nextPath={nextPath} />
    </div>
  );
}
