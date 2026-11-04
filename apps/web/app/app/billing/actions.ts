'use server';

import { redirect } from 'next/navigation';

import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { createClient } from '../../../lib/supabase/server';

const PADDLE_PORTAL_HOSTS = new Set([
  'customer-portal.paddle.com',
  'sandbox-customer-portal.paddle.com',
]);

function isSafePaddlePortalUrl(candidate: unknown): candidate is string {
  if (typeof candidate !== 'string') return false;

  try {
    const url = new URL(candidate);
    return (
      url.protocol === 'https:' &&
      PADDLE_PORTAL_HOSTS.has(url.hostname) &&
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

  if (!isSafePaddlePortalUrl(portalUrl)) {
    redirect('/app/billing?portal=unavailable');
  }

  redirect(portalUrl);
}
