import { notFound } from 'next/navigation';

import { isUnsubscribeToken } from '../../../lib/email/unsubscribe-token';
import { createClient } from '../../../lib/supabase/server';
import { unsubscribeAction } from './actions';
import '../../quote/[token]/styles.css';

export const dynamic = 'force-dynamic';

// Rendering never unsubscribes: link scanners prefetch email URLs, so the
// opt-out happens only on an explicit button press or a one-click POST.
export default async function UnsubscribePage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ token: string }>;
  searchParams: Promise<{ result?: string }>;
}>) {
  const { token } = await params;
  const { result } = await searchParams;
  if (!isUnsubscribeToken(token)) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('preview_marketing_unsubscribe', {
    unsubscribe_token: token,
  });
  const preview = data?.[0];
  if (error || !preview) notFound();

  const unsubscribed = preview.already_unsubscribed || result === 'done';

  return (
    <main className="public-quote-shell">
      <section className="public-quote-card">
        <header className="public-quote-header">
          <div className="public-quote-brand">
            <span>C</span> CrewFlow
          </div>
          <p>Email preferences for {preview.company_name}</p>
        </header>
        <div className="public-quote-intro">
          <h1>
            {unsubscribed
              ? 'You are unsubscribed'
              : 'Unsubscribe from review emails?'}
          </h1>
          <p>
            {unsubscribed
              ? `${preview.company_name} will no longer send you review requests or other marketing email through CrewFlow.`
              : `You will stop receiving review requests and other marketing email from ${preview.company_name}. Service messages about your jobs and invoices are not affected.`}
          </p>
        </div>

        {result === 'error' ? (
          <p className="public-quote-error" role="alert">
            Your preference could not be saved. Please try again.
          </p>
        ) : null}

        {unsubscribed ? (
          <p className="public-quote-success" role="status">
            Preference saved.
          </p>
        ) : (
          <form action={unsubscribeAction.bind(null, token)}>
            <button className="public-quote-accept" type="submit">
              Unsubscribe
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
