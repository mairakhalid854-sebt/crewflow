import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function read(path: string): string {
  // Windows checkouts may use CRLF; assertions are written against LF.
  return readFileSync(
    new URL(`../../../${path}`, import.meta.url),
    'utf8',
  ).replace(/\r\n/g, '\n');
}

const kindMigration = read(
  'supabase/migrations/202610280002_phase7_work_report_email_kind.sql',
);
const migration = read(
  'supabase/migrations/202610280003_phase7_work_report_email.sql',
);

describe('work report email migrations', () => {
  it('commits the enum value before any function references it', () => {
    expect(kindMigration).toContain(
      "ALTER TYPE public.transactional_email_kind ADD VALUE IF NOT EXISTS 'work_report';",
    );
    expect(kindMigration).not.toContain('FUNCTION');
  });

  it('verifies the report token and current sent state', () => {
    expect(migration).toContain('report.public_token_hash = hashed');
    expect(migration).toContain('report.public_token_hash = target_token_hash');
    expect(migration).toContain("report.status = 'sent'");
    expect(migration).toContain("email_link_path := '/report/' || link_token;");
  });

  it('keeps the earlier kinds and link constraint intact', () => {
    expect(migration).toContain('quote.decision_token_hash = hashed');
    expect(migration).toContain('invoice.public_token_hash = hashed');
    expect(migration).toContain('invitation.token_hash = hashed');
    expect(migration).toContain(
      "'^/(quote/|invoice/|report/|signup\\?next=%2Finvite%2F)[0-9a-f]{64}$'",
    );
  });
});
