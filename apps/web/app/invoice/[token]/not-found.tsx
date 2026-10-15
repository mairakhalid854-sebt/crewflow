import Link from 'next/link';

import '../../quote/[token]/styles.css';

export default function InvoiceNotFound() {
  return (
    <main className="public-quote-shell">
      <section className="public-quote-card public-quote-unavailable">
        <div className="public-quote-brand">
          <span>C</span> CrewFlow
        </div>
        <p className="public-quote-kicker">INVOICE UNAVAILABLE</p>
        <h1>This link is invalid or no longer available.</h1>
        <p>Ask the service business to send the secure invoice link again.</p>
        <Link href="/">Return to CrewFlow</Link>
      </section>
    </main>
  );
}
