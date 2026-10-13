import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { createClient } from '../../../lib/supabase/server';

import { PersonalProfileForm } from './profile-form';

export const dynamic = 'force-dynamic';

function roleLabel(role: 'owner' | 'office' | 'technician'): string {
  if (role === 'owner') return 'Owner';
  if (role === 'office') return 'Office staff';
  return 'Technician';
}

export default async function PersonalProfilePage() {
  const context = await requireTenantContext();
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const email = typeof claims?.email === 'string' ? claims.email : '';

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('user_id', context.userId)
    .maybeSingle();

  if (error) throw new Error('Your profile could not be loaded.');

  return (
    <div className="workspace-page resource-editor-page settings-page">
      <header className="workspace-heading">
        <div>
          <p className="workspace-kicker">Your account</p>
          <h1>My profile</h1>
          <p>Manage the identity attached to your CrewFlow account.</p>
        </div>
      </header>
      <PersonalProfileForm
        email={email}
        fullName={profile?.full_name || context.userName}
        roleLabel={roleLabel(context.role)}
      />
    </div>
  );
}
