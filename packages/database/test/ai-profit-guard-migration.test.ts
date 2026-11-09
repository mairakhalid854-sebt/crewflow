import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202611090008_ai_profit_guard.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Job Profit Guard migration', () => {
  it('measures real job time from recorded status changes', () => {
    expect(migration).toContain("event.metadata ->> 'to' = 'completed'");
    expect(migration).toContain(
      "start_event.metadata ->> 'to' = 'in_progress'",
    );
    expect(migration).toContain('timed.minutes BETWEEN 5 AND 1440');
    expect(migration).toContain('percentile_cont(0.5)');
  });

  it('uses invoices, then accepted quotes, then the list price for revenue', () => {
    expect(migration).toContain(
      'coalesce(invoice_total.revenue, quote_total.revenue, service.unit_price_cents)',
    );
    expect(migration).toContain("invoice.status <> 'void'");
    expect(migration).toContain("quote.status = 'accepted'");
  });

  it('never invents market prices and requires a source and date', () => {
    expect(migration).toContain(
      'char_length(trim(market_price_source)) BETWEEN 2 AND 200',
    );
    expect(migration).toContain('market_price_checked_on IS NOT NULL');
    expect(migration).not.toMatch(/http|openai|scrape/i);
  });

  it('keeps profit data owner-only and audits market price changes', () => {
    expect(migration).toContain("'only an active owner can view profit data'");
    expect(migration).toContain("'only an active owner can set market prices'");
    expect(migration).toContain("'service.market_price_set'");
  });
});
