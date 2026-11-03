import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610250010_phase6_follow_up_orchestration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('phase 6 Follow-Up orchestration', () => {
  it('creates a tenant-bound provider-neutral delivery queue', () => {
    expect(migration).toContain('CREATE TABLE public.follow_up_messages');
    expect(migration).toContain('follow_up_messages_invoice_tenant_fk');
    expect(migration).toContain('follow_up_messages_customer_tenant_fk');
    expect(migration).toContain('follow_up_messages_dedupe_unique');
    expect(migration).toContain("'awaiting_approval'");
    expect(migration).toContain("'ready'");
  });

  it('honors milestones, payment state, preferences, and suppression', () => {
    expect(migration).toContain('IN (3, 7, 14)');
    expect(migration).toContain('days_since_paid');
    expect(migration).toContain('marketing_email_opted_in');
    expect(migration).toContain('transactional_email_allowed');
    expect(migration).toContain('email_suppressed_at IS NULL');
    expect(migration).toContain('invoice.paid_cents < invoice.total_cents');
    expect(migration).toContain("invoice.status = 'paid'");
  });

  it('creates governed exact approvals without sending email', () => {
    expect(migration).toContain('INSERT INTO public.ai_agent_runs');
    expect(migration).toContain('INSERT INTO public.ai_run_steps');
    expect(migration).toContain('INSERT INTO public.ai_approval_requests');
    expect(migration).toContain("'follow_up.queue_message'");
    expect(migration).not.toContain('net.http_post');
    expect(migration).not.toContain('send_email');
    expect(migration).not.toContain('provider API');
  });

  it('revalidates approved messages before making them ready', () => {
    expect(migration).toContain(
      'CREATE FUNCTION public.execute_approved_follow_up_message',
    );
    expect(migration).toContain("approval.status <> 'approved'");
    expect(migration).toContain("subscription.access_mode = 'full'");
    expect(migration).toContain(
      'current_state IS DISTINCT FROM approval.target_state_version',
    );
    expect(migration).toContain("SET status = 'ready'");
    expect(migration).toContain("'rejected_stale'");
    expect(migration).toContain("'rejected_policy'");
  });

  it('schedules daily service-only evaluation and denies browser writes', () => {
    expect(migration).toContain("auth.role() IS DISTINCT FROM 'service_role'");
    expect(migration).toContain("'15 14 * * *'");
    expect(migration).toContain('crewflow-follow-up-daily');
    expect(migration).toContain('REVOKE ALL ON public.follow_up_messages');
    expect(migration).toContain('GRANT SELECT ON public.follow_up_messages');
  });
});
