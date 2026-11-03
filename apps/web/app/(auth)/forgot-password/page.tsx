import { ForgotPasswordForm } from '../auth-forms';

export default async function ForgotPasswordPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ error?: string | string[] }>;
}>) {
  const error = (await searchParams).error;

  return (
    <div className="auth-card">
      <p className="step-label">ACCOUNT RECOVERY</p>
      <h2>Reset your password</h2>
      <p className="auth-intro">
        We’ll send a single-purpose reset link if the account exists.
      </p>
      {error === 'invalid_or_expired_link' ? (
        <p className="form-message error" role="alert">
          This reset link is invalid or expired. Request a new link below.
        </p>
      ) : null}
      <ForgotPasswordForm />
    </div>
  );
}
