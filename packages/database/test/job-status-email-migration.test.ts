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
  'supabase/migrations/202610280006_phase7_job_status_email_kinds.sql',
);
const migration = read(
  'supabase/migrations/202610280007_phase7_job_status_emails.sql',
);

describe('job status email migrations', () => {
  it('commits the new kinds before any function references them', () => {
    for (const kind of ['job_scheduled', 'job_rescheduled', 'job_cancelled']) {
      expect(kindMigration).toContain(
        `ALTER TYPE public.transactional_email_kind ADD VALUE IF NOT EXISTS '${kind}';`,
      );
    }
    expect(kindMigration).not.toContain('FUNCTION');
  });

  it('lets owners turn appointment emails off', () => {
    expect(migration).toContain(
      'ADD COLUMN customer_appointment_emails_enabled boolean NOT NULL DEFAULT true',
    );
    expect(migration).toContain('setting.customer_appointment_emails_enabled');
  });

  it('never blocks the job update that queues an email', () => {
    expect(migration).toContain(
      'WHEN check_violation OR not_null_violation OR string_data_right_truncation THEN',
    );
    expect(migration).toContain(
      'AFTER UPDATE OF status, scheduled_start_at, scheduled_end_at ON public.jobs',
    );
  });

  it('keeps job emails link-free and supersedes stale appointment times', () => {
    expect(migration).toContain("AND position('{{link}}' IN body) = 0");
    expect(migration).toContain('job.scheduled_start_at, job.scheduled_end_at');
    expect(migration).toContain('AND job.scheduled_start_at > now()');
  });

  it('refuses direct requests for job email kinds', () => {
    expect(migration).toContain(
      "IF target_kind NOT IN ('team_invitation', 'quote', 'invoice', 'work_report') THEN",
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.queue_job_status_email()\n  FROM PUBLIC, anon, authenticated;',
    );
  });
});
