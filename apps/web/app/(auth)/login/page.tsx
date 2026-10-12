import { LoginForm } from '../auth-forms';
import { safeNextPath } from '../../../lib/auth/safe-next-path';

export default async function LoginPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ next?: string | string[] }>;
}>) {
  const nextPath = safeNextPath((await searchParams).next);

  return (
    <div className="auth-card">
      <p className="step-label">WELCOME BACK</p>
      <h2>Sign in to CrewFlow</h2>
      <p className="auth-intro">Pick up where your crew left off.</p>
      <LoginForm nextPath={nextPath} />
    </div>
  );
}
