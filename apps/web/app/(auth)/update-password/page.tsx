import { UpdatePasswordForm } from '../auth-forms';

export const dynamic = 'force-dynamic';

export default function UpdatePasswordPage() {
  return (
    <div className="auth-card">
      <p className="step-label">SECURE RESET</p>
      <h2>Choose a new password</h2>
      <p className="auth-intro">The recovery session must still be valid.</p>
      <UpdatePasswordForm />
    </div>
  );
}
