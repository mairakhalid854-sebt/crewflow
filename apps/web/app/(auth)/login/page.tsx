import { LoginForm } from '../auth-forms';

export default function LoginPage() {
  return (
    <div className="auth-card">
      <p className="step-label">WELCOME BACK</p>
      <h2>Sign in to CrewFlow</h2>
      <p className="auth-intro">Pick up where your crew left off.</p>
      <LoginForm />
    </div>
  );
}
