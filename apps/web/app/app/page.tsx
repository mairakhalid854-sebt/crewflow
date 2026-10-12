import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createClient } from '../../lib/supabase/server';
import { DashboardPreview } from '../page';

export const dynamic = 'force-dynamic';

const membershipSchema = z.object({
  role: z.enum(['owner', 'office', 'technician']),
  tenants: z.object({ display_name: z.string() }),
});

export default async function AuthenticatedDashboardPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub) redirect('/login');

  const { data } = await supabase
    .from('memberships')
    .select('role, tenants!inner(display_name)')
    .eq('user_id', claims.sub)
    .eq('status', 'active')
    .maybeSingle();

  const parsedMembership = membershipSchema.safeParse(data);
  if (!parsedMembership.success) redirect('/onboarding');

  const metadataName =
    typeof claims.user_metadata?.full_name === 'string'
      ? claims.user_metadata.full_name
      : null;
  const fallbackName =
    typeof claims.email === 'string' ? claims.email.split('@')[0] : 'Owner';

  return (
    <DashboardPreview
      tenantName={parsedMembership.data.tenants.display_name}
      userName={metadataName ?? fallbackName}
    />
  );
}
