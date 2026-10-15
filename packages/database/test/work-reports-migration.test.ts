import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610150006_phase3_work_reports.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Phase 3 work reports migration', () => {
  it('binds each report to the job, customer, and tenant', () => {
    expect(migration).toContain('work_reports_job_tenant_fk');
    expect(migration).toContain('work_reports_customer_tenant_fk');
    expect(migration).toContain('FOREIGN KEY (job_id, tenant_id)');
    expect(migration).toContain('FOREIGN KEY (customer_id, tenant_id)');
  });

  it('limits draft and approval actions to owner and office users', () => {
    expect(migration).toContain('CREATE FUNCTION public.save_job_work_report');
    expect(migration).toContain(
      'CREATE FUNCTION public.publish_job_work_report',
    );
    expect(
      migration.match(/ARRAY\['owner', 'office'\]/g)?.length,
    ).toBeGreaterThan(1);
    expect(migration).toContain("job.status IN ('completed', 'closed')");
  });

  it('stores only a SHA-256 token hash and exposes a narrow public RPC', () => {
    expect(migration).toContain('extensions.gen_random_bytes(32)');
    expect(migration).toContain(
      "extensions.digest(pg_catalog.convert_to(generated_token, 'UTF8'), 'sha256')",
    );
    expect(migration).toContain(
      'CREATE FUNCTION public.get_public_work_report',
    );
    expect(migration).toContain("report_token ~ '^[0-9a-f]{64}$'");
    expect(migration).toContain(
      'REVOKE ALL ON public.work_reports FROM anon, authenticated',
    );
  });

  it('keeps one editable draft and audits save and approval', () => {
    expect(migration).toContain('work_reports_one_draft_per_job_idx');
    expect(migration).toContain("'report.saved'");
    expect(migration).toContain("'report.approved_sent'");
    expect(migration).toContain("SET status = 'void'");
  });
});
