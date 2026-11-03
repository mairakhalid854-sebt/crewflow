import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610190001_phase4_push_notifications.sql',
    import.meta.url,
  ),
  'utf8',
);
const edgeFunction = readFileSync(
  new URL(
    '../../../supabase/functions/process-push-notifications/index.js',
    import.meta.url,
  ),
  'utf8',
);

describe('phase 4 push notifications', () => {
  it('keeps device tokens private and tenant-bound', () => {
    expect(migration).toContain('mobile_push_tokens_membership_tenant_fk');
    expect(migration).toContain('mobile_push_tokens_active_token_unique');
    expect(migration).toContain(
      'ALTER TABLE public.mobile_push_tokens ENABLE ROW LEVEL SECURITY',
    );
    expect(migration).toContain(
      'REVOKE ALL ON public.mobile_push_tokens FROM anon, authenticated',
    );
    expect(migration).not.toContain(
      'GRANT SELECT ON public.mobile_push_tokens TO authenticated',
    );
  });

  it('registers rotations through authenticated, membership-scoped commands', () => {
    expect(migration).toContain(
      'CREATE FUNCTION public.register_mobile_push_token',
    );
    expect(migration).toContain("membership.status = 'active'");
    expect(migration).toContain('ON CONFLICT (user_id, device_id) DO UPDATE');
    expect(migration).toContain('token.expo_push_token = normalized_token');
    expect(migration).toContain(
      'CREATE FUNCTION public.disable_mobile_push_token',
    );
  });

  it('supports granular opt-outs without exposing preference tables directly', () => {
    expect(migration).toContain('job_assignments_enabled boolean');
    expect(migration).toContain('schedule_changes_enabled boolean');
    expect(migration).toContain('cancellations_enabled boolean');
    expect(migration).toContain('approvals_enabled boolean');
    expect(migration).toContain(
      'CREATE FUNCTION public.update_mobile_notification_preferences',
    );
  });

  it('queues assignment, reschedule, cancellation, and approval events', () => {
    for (const kind of [
      'job_assigned',
      'job_rescheduled',
      'job_cancelled',
      'approval_requested',
    ]) {
      expect(migration).toContain(kind);
    }
    expect(migration).toContain('jobs_queue_push_notifications');
    expect(migration).toContain('quotes_queue_approval_push');
    expect(migration).toContain('invoices_queue_approval_push');
    expect(migration).toContain('work_reports_queue_approval_push');
  });

  it('uses per-device idempotency, leases, bounded batches, and terminal retries', () => {
    expect(migration).toContain('UNIQUE (event_id, token_id)');
    expect(migration).toContain('FOR UPDATE OF delivery SKIP LOCKED');
    expect(migration).toContain("now() - interval '15 minutes'");
    expect(migration).toContain('batch_size NOT BETWEEN 1 AND 100');
    expect(migration).toContain('delivery.attempts >= 5');
  });

  it('keeps delivery RPCs service-only', () => {
    expect(migration.match(/TO service_role;/g)).toHaveLength(4);
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
  });

  it('sends generic deep-link payloads through Expo with safe retry handling', () => {
    expect(edgeFunction).toContain("'https://exp.host/--/api/v2/push/send'");
    expect(edgeFunction).toContain('deepLink: delivery.deep_link');
    expect(edgeFunction).toContain(
      "ticket?.details?.error === 'DeviceNotRegistered'",
    );
    expect(edgeFunction).toContain("'retry_push_notification_deliveries'");
    expect(edgeFunction).toContain("request.headers.get('apikey')");
    expect(edgeFunction).not.toContain('customer_name');
    expect(edgeFunction).not.toContain('street_address');
  });
});
