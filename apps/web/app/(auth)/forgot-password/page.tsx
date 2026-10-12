import { ForgotPasswordForm } from '../auth-forms';

export default function ForgotPasswordPage() {
  return (
    <div className="auth-card">
      <p className="step-label">ACCOUNT RECOVERY</p>
      <h2>Reset your password</h2>
      <p className="auth-intro">
        We’ll send a single-purpose reset link if the account exists.
      </p>
      <ForgotPasswordForm />
    </div>
  );
}
