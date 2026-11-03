import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireTenantContext } from '../../../../lib/auth/tenant-context';
import { createClient } from '../../../../lib/supabase/server';
import { StaffDetailsForm } from '../staff-details-form';
import { TimeOffPanel } from '../time-off-panel';

export const dynamic = 'force-dynamic';

export default async function StaffDetailsPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const context = await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const recentCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [membershipResult, profileResult, availabilityResult, timeOffResult] =
    await Promise.all([
      supabase
        .from('memberships')
        .select('id, role, status')
        .eq('id', id)
        .eq('tenant_id', context.tenantId)
        .maybeSingle(),
      supabase
        .from('staff_profiles')
        .select('*')
        .eq('membership_id', id)
        .eq('tenant_id', context.tenantId)
        .maybeSingle(),
      supabase
        .from('staff_availability')
        .select('*')
        .eq('membership_id', id)
        .eq('tenant_id', context.tenantId)
        .order('day_of_week'),
      supabase
        .from('staff_time_off')
        .select('*')
        .eq('membership_id', id)
        .eq('tenant_id', context.tenantId)
        .gte('ends_at', recentCutoff.toISOString())
        .order('starts_at'),
    ]);

  if (
    membershipResult.error ||
    profileResult.error ||
    availabilityResult.error ||
    timeOffResult.error
  ) {
    throw new Error('Unable to load staff details.');
  }
  if (!membershipResult.data || !profileResult.data) notFound();

  return (
    <div className="workspace-page resource-editor-page">
      <Link className="back-link" href="/app/team">
        ← Back to team
      </Link>
      <header>
        <p className="workspace-kicker">Staff profile</p>
        <h1>{profileResult.data.full_name}</h1>
        <p>
          Update skills, service areas, and weekly availability. Historical
          records are retained after deactivation.
        </p>
      </header>

      {membershipResult.data.status === 'active' ? (
        <StaffDetailsForm
          availability={availabilityResult.data ?? []}
          profile={profileResult.data}
        />
      ) : (
        <div className="empty-state">
          <h2>This team member is deactivated</h2>
          <p>The retained staff record is read-only.</p>
        </div>
      )}

      {membershipResult.data.role === 'technician' ? (
        <TimeOffPanel
          canAdd={membershipResult.data.status === 'active'}
          membershipId={membershipResult.data.id}
          timeOff={timeOffResult.data ?? []}
          timeZone={context.timeZone}
        />
      ) : null}
    </div>
  );
}
