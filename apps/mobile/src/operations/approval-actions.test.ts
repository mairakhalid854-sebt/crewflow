import type { Database } from '@crewflow/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { OperationsApproval } from './mobile-operations';
import {
  approveOperationsItem,
  resolveMobileWebAppUrl,
} from './approval-actions';

const approvalBase = {
  id: 'approval-1',
  jobId: 'job-1',
  jobTitle: 'Annual service',
  updatedAt: '2026-10-18T12:00:00.000Z',
} as const;
const publicToken = 'a'.repeat(64);

function mockClient(data: string | null, error: { message: string } | null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return {
    client: { rpc } as unknown as SupabaseClient<Database>,
    rpc,
  };
}

describe('mobile approval actions', () => {
  it('normalizes a configured web app URL', () => {
    expect(resolveMobileWebAppUrl(' https://crewflow.example.com/ ')).toBe(
      'https://crewflow.example.com',
    );
  });

  it.each([undefined, '', 'ftp://crewflow.example.com', 'not-a-url'])(
    'rejects an unsafe or missing web app URL',
    (value) => {
      expect(() => resolveMobileWebAppUrl(value)).toThrow(
        /Customer link configuration/,
      );
    },
  );

  it.each<{
    approval: OperationsApproval;
    expectedArgs: Record<string, string>;
    expectedRpc: string;
    route: string;
  }>([
    {
      approval: {
        ...approvalBase,
        expiresAt: '2026-11-18T12:00:00.000Z',
        kind: 'quote',
        totalCents: 25000,
      },
      expectedArgs: { target_quote_id: 'approval-1' },
      expectedRpc: 'publish_job_quote',
      route: 'quote',
    },
    {
      approval: {
        ...approvalBase,
        dueAt: '2026-11-18T12:00:00.000Z',
        invoiceNumber: 1001,
        kind: 'invoice',
        totalCents: 25000,
      },
      expectedArgs: { target_invoice_id: 'approval-1' },
      expectedRpc: 'publish_job_invoice',
      route: 'invoice',
    },
    {
      approval: {
        ...approvalBase,
        kind: 'report',
        partsUsed: null,
        recommendations: null,
        summary: 'Completed service',
        workPerformed: 'Inspected equipment',
      },
      expectedArgs: { target_report_id: 'approval-1' },
      expectedRpc: 'publish_job_work_report',
      route: 'report',
    },
  ])(
    'publishes a $approval.kind and returns its customer URL',
    async ({ approval, expectedArgs, expectedRpc, route }) => {
      const { client, rpc } = mockClient(publicToken, null);

      await expect(
        approveOperationsItem(
          client,
          'office',
          approval,
          'https://crewflow.example.com/',
        ),
      ).resolves.toEqual({
        customerUrl: `https://crewflow.example.com/${route}/${publicToken}`,
      });
      expect(rpc).toHaveBeenCalledWith(expectedRpc, expectedArgs);
    },
  );

  it('does not call the database when the role is technician', async () => {
    const { client, rpc } = mockClient(publicToken, null);
    const approval: OperationsApproval = {
      ...approvalBase,
      expiresAt: '2026-11-18T12:00:00.000Z',
      kind: 'quote',
      totalCents: 25000,
    };

    await expect(
      approveOperationsItem(
        client,
        'technician',
        approval,
        'https://crewflow.example.com',
      ),
    ).rejects.toThrow('Only an owner or office member');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('validates configuration before publishing a document', async () => {
    const { client, rpc } = mockClient(publicToken, null);
    const approval: OperationsApproval = {
      ...approvalBase,
      dueAt: '2026-11-18T12:00:00.000Z',
      invoiceNumber: 1001,
      kind: 'invoice',
      totalCents: 25000,
    };

    await expect(
      approveOperationsItem(client, 'owner', approval, undefined),
    ).rejects.toThrow('Customer link configuration is missing');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns a safe message when publishing fails', async () => {
    const { client } = mockClient(null, { message: 'database details' });
    const approval: OperationsApproval = {
      ...approvalBase,
      kind: 'report',
      partsUsed: null,
      recommendations: null,
      summary: 'Completed service',
      workPerformed: 'Inspected equipment',
    };

    await expect(
      approveOperationsItem(
        client,
        'owner',
        approval,
        'https://crewflow.example.com',
      ),
    ).rejects.toThrow('This item could not be approved');
  });
});
