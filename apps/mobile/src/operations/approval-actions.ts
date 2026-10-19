import type { Database } from '@crewflow/database';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { OperationsApproval } from './mobile-operations';

export type ApprovalResult = {
  readonly customerUrl: string;
};

export function resolveMobileWebAppUrl(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(
      'Customer link configuration is missing. Ask an administrator to configure the mobile app.',
    );
  }

  try {
    const parsed = new URL(normalized);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error('invalid');
    }
  } catch {
    throw new Error(
      'Customer link configuration is invalid. Ask an administrator to configure the mobile app.',
    );
  }

  return new URL(normalized).origin;
}

export async function approveOperationsItem(
  client: SupabaseClient<Database>,
  role: 'office' | 'owner' | 'technician',
  approval: OperationsApproval,
  webAppUrl: string | undefined,
): Promise<ApprovalResult> {
  if (role === 'technician') {
    throw new Error('Only an owner or office member can approve this item.');
  }

  const baseUrl = resolveMobileWebAppUrl(webAppUrl);
  let result: { data: string | null; error: { message: string } | null };
  let route: 'invoice' | 'quote' | 'report';

  switch (approval.kind) {
    case 'invoice':
      route = 'invoice';
      result = await client.rpc('publish_job_invoice', {
        target_invoice_id: approval.id,
      });
      break;
    case 'quote':
      route = 'quote';
      result = await client.rpc('publish_job_quote', {
        target_quote_id: approval.id,
      });
      break;
    case 'report':
      route = 'report';
      result = await client.rpc('publish_job_work_report', {
        target_report_id: approval.id,
      });
      break;
  }

  if (result.error || !result.data || !/^[a-f\d]{64}$/i.test(result.data)) {
    throw new Error(
      'This item could not be approved. Refresh its details and try again.',
    );
  }

  return {
    customerUrl: `${baseUrl}/${route}/${encodeURIComponent(result.data)}`,
  };
}
