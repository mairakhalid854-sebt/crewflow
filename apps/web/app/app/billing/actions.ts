'use server';

import { redirect } from 'next/navigation';

import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { createClient } from '../../../lib/supabase/server';

const PADDLE_SANDBOX_PORTAL_HOST = 'sandbox-customer-portal.paddle.com';

function isSafePaddleSandboxPortalUrl(candidate: unknown): candidate is string {
  if (typeof candidate !== 'string') return false;

  try {
    const url = new URL(candidate);
    return (
      url.protocol === 'https:' &&
      url.hostname === PADDLE_SANDBOX_PORTAL_HOST &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

function portalUrlFromInvocation(result: unknown): unknown {
  if (!result || typeof result !== 'object') return undefined;
  const invocation = result as Record<string, unknown>;
  if (invocation.error) return undefined;
  if (!invocation.data || typeof invocation.data !== 'object') {
    return undefined;
  }
  return (invocation.data as Record<string, unknown>).portal_url;
}

export async function openBillingPortalAction(): Promise<void> {
  await requireTenantContext(['owner']);
  const supabase = await createClient();
  const invocation: unknown = await supabase.functions.invoke(
    'create-paddle-portal-session',
    { body: {} },
  );
  const portalUrl = portalUrlFromInvocation(invocation);

  if (!isSafePaddleSandboxPortalUrl(portalUrl)) {
    redirect('/app/billing?portal=unavailable');
  }

  redirect(portalUrl);
}
