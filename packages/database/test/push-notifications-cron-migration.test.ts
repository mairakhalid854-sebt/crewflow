import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610190002_schedule_push_notifications.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('phase 4 push notification scheduler', () => {
  it('bootstraps the required extensions on a fresh database', () => {
    expect(migration).toContain('CREATE EXTENSION IF NOT EXISTS pg_cron');
    expect(migration).toContain('CREATE EXTENSION IF NOT EXISTS pg_net');
  });

  it('keeps project URL and function credentials encrypted in Vault', () => {
    expect(migration).toContain("'crewflow_project_url'");
    expect(migration).toContain("'crewflow_edge_function_service_key'");
    expect(migration).toContain('vault.create_secret');
    expect(migration).toContain('vault.update_secret');
    expect(migration).toContain('vault.decrypted_secrets');
  });

  it('runs the bounded delivery worker every minute through pg_net', () => {
    expect(migration).toContain("'crewflow-process-push-notifications'");
    expect(migration).toContain("'* * * * *'");
    expect(migration).toContain('net.http_post');
    expect(migration).toContain("'/functions/v1/process-push-notifications'");
    expect(migration).toContain('timeout_milliseconds := 10000');
  });

  it('limits configuration and status commands to the service role', () => {
    expect(migration).toContain("auth.role() IS DISTINCT FROM 'service_role'");
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.configure_push_notification_cron(text, text)',
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.get_push_notification_cron_status()',
    );
    expect(migration.match(/TO service_role;/g)).toHaveLength(2);
  });

  it('exposes service-only run status without returning secret values', () => {
    expect(migration).toContain(
      'CREATE FUNCTION public.get_push_notification_cron_status()',
    );
    expect(migration).toContain('cron.job_run_details');
    expect(migration).not.toContain('RETURNS TABLE (\n  decrypted_secret');
  });
});
