import Link from 'next/link';

import './styles.css';

export default function QuoteNotFound() {
  return (
    <main className="public-quote-shell">
      <section className="public-quote-card public-quote-unavailable">
        <div className="public-quote-brand">
          <span>C</span> CrewFlow
        </div>
        <p className="public-quote-kicker">QUOTE UNAVAILABLE</p>
        <h1>This link is invalid or no longer available.</h1>
        <p>Ask the service business to send a new secure quote link.</p>
        <Link href="/">Return to CrewFlow</Link>
      </section>
    </main>
  );
}
