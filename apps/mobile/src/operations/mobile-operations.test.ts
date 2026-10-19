import { describe, expect, it } from 'vitest';

import type { OperationsInvoice, OperationsJob } from './mobile-operations';
import {
  buildOperationsApprovals,
  buildOperationsMetrics,
  formatUsdCents,
  localDateKey,
} from './mobile-operations';

function job(overrides: Partial<OperationsJob> = {}): OperationsJob {
  return {
    assigned_membership_id: 'member-1',
    customers: {
      address_line_2: null,
      city: 'Austin',
      first_name: 'Alex',
      last_name: 'Morgan',
      phone: '512-555-0100',
      postal_code: '78701',
      state_code: 'TX',
      street_address: '100 Main St',
    },
    description: null,
    id: 'job-1',
    priority: 'normal',
    scheduled_end_at: '2026-10-17T00:00:00.000Z',
    scheduled_start_at: '2026-10-16T23:00:00.000Z',
    services: { name: 'Inspection' },
    status: 'scheduled',
    title: 'Fall inspection',
    updated_at: '2026-10-16T18:00:00.000Z',
    ...overrides,
  };
}

function invoice(
  overrides: Partial<OperationsInvoice> = {},
): OperationsInvoice {
  return {
    due_at: '2026-10-20T00:00:00.000Z',
    id: 'invoice-1',
    invoice_number: 1001,
    job_id: 'job-1',
    paid_cents: 0,
    status: 'sent',
    total_cents: 25000,
    updated_at: '2026-10-16T18:00:00.000Z',
    ...overrides,
  };
}

describe('mobile operations overview', () => {
  it('uses the business time zone for today and monthly revenue', () => {
    expect(
      localDateKey(new Date('2026-10-17T04:30:00.000Z'), 'America/Los_Angeles'),
    ).toBe('2026-10-16');

    const metrics = buildOperationsMetrics({
      approvals: [
        { id: 'approval-1', job_id: 'job-1', updated_at: '2026-10-16' },
      ],
      invoices: [invoice()],
      jobs: [job(), job({ assigned_membership_id: null, id: 'job-2' })],
      now: new Date('2026-10-17T04:30:00.000Z'),
      payments: [
        { amount_cents: 5000, received_at: '2026-10-01T12:00:00.000Z' },
        { amount_cents: 7000, received_at: '2026-09-30T12:00:00.000Z' },
      ],
      role: 'owner',
      timeZone: 'America/Los_Angeles',
    });

    expect(metrics).toEqual({
      activeCount: 2,
      monthlyReceivedCents: 5000,
      openCount: 2,
      pendingApprovalCount: 1,
      todayCount: 2,
      unassignedCount: 1,
      unpaidCount: 1,
    });
  });

  it('does not expose a revenue metric to office users', () => {
    const metrics = buildOperationsMetrics({
      approvals: [],
      invoices: [invoice({ status: 'paid' })],
      jobs: [job({ status: 'closed' })],
      now: new Date('2026-10-17T04:30:00.000Z'),
      payments: [{ amount_cents: 9000, received_at: '2026-10-02' }],
      role: 'office',
      timeZone: 'America/Los_Angeles',
    });

    expect(metrics.monthlyReceivedCents).toBeUndefined();
    expect(metrics.openCount).toBe(0);
    expect(metrics.unpaidCount).toBe(0);
  });

  it('formats owner ledger totals in USD', () => {
    expect(formatUsdCents(123456)).toBe('$1,234.56');
  });

  it('builds detailed approvals and excludes non-draft invoices', () => {
    const approvals = buildOperationsApprovals({
      invoices: [
        invoice({ status: 'draft', updated_at: '2026-10-16T20:00:00.000Z' }),
        invoice({ id: 'paid-invoice', status: 'paid' }),
      ],
      jobs: [job()],
      quotes: [
        {
          expires_at: '2026-11-16T00:00:00.000Z',
          id: 'quote-1',
          job_id: 'job-1',
          total_cents: 30000,
          updated_at: '2026-10-16T22:00:00.000Z',
        },
      ],
      reports: [
        {
          id: 'report-1',
          job_id: 'missing-job',
          parts_used: 'Filter',
          recommendations: null,
          summary: 'Service complete',
          updated_at: '2026-10-16T21:00:00.000Z',
          work_performed: 'Replaced filter',
        },
      ],
    });

    expect(approvals).toHaveLength(3);
    expect(approvals.map((approval) => approval.kind)).toEqual([
      'quote',
      'report',
      'invoice',
    ]);
    expect(approvals[0]).toMatchObject({
      expiresAt: '2026-11-16T00:00:00.000Z',
      jobTitle: 'Fall inspection',
      totalCents: 30000,
    });
    expect(approvals[1]?.jobTitle).toBe('Archived or unavailable job');
  });
});
