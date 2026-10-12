import { SignupForm } from '../auth-forms';

export default function SignupPage() {
  return (
    <div className="auth-card">
      <p className="step-label">OWNER ACCOUNT</p>
      <h2>Start your CrewFlow workspace</h2>
      <p className="auth-intro">
        Your email must be verified before company setup.
      </p>
      <SignupForm />
    </div>
  );
}
