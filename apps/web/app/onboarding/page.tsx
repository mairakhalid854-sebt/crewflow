import { redirect } from 'next/navigation';

import { createClient } from '../../lib/supabase/server';
import { OnboardingForm } from './onboarding-form';
import './styles.css';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect('/login');

  const { data } = await supabase
    .from('memberships')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1);
  if (data?.length) redirect('/app');

  return (
    <main className="onboarding-shell">
      <header className="onboarding-header">
        <a className="brand" href="/">
          <span className="brand-mark">C</span>
          <span>CrewFlow</span>
        </a>
        <span>Company setup</span>
      </header>
      <section className="onboarding-content">
        <div className="onboarding-title">
          <div>
            <p>STEP 1 OF 1</p>
            <h1>Tell us about your business</h1>
            <span>
              These defaults can be changed later by the company owner.
            </span>
          </div>
          <div className="secure-note">
            <strong>Private by default</strong>
            <span>
              Your workspace is isolated from every other CrewFlow company.
            </span>
          </div>
        </div>
        <OnboardingForm />
      </section>
    </main>
  );
}
