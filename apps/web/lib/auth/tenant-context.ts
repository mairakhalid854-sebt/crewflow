import { notFound, redirect } from 'next/navigation';

import type { Database } from '@crewflow/database';

import { createClient } from '../supabase/server';

type MembershipRole = Database['public']['Enums']['membership_role'];

export interface WebTenantContext {
  readonly role: MembershipRole;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly timeZone: string;
  readonly userId: string;
  readonly userName: string;
}

export async function requireTenantContext(
  allowedRoles?: readonly MembershipRole[],
): Promise<WebTenantContext> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub) redirect('/login');

  const { data, error } = await supabase
    .from('memberships')
    .select('role, tenant_id, tenants!inner(display_name, time_zone)')
    .eq('user_id', claims.sub)
    .eq('status', 'active')
    .maybeSingle();

  if (error)
    throw new Error('Unable to resolve the active company membership.');
  if (!data) redirect('/onboarding');
  if (allowedRoles && !allowedRoles.includes(data.role)) notFound();

  const metadataName =
    typeof claims.user_metadata?.full_name === 'string'
      ? claims.user_metadata.full_name
      : null;
  const fallbackName =
    typeof claims.email === 'string'
      ? (claims.email.split('@')[0] ?? 'Member')
      : 'Member';

  return {
    role: data.role,
    tenantId: data.tenant_id,
    tenantName: data.tenants.display_name,
    timeZone: data.tenants.time_zone,
    userId: claims.sub,
    userName: metadataName ?? fallbackName,
  };
}
