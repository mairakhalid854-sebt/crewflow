import Link from 'next/link';

import type { Database, Tables } from '@crewflow/database';

import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { createClient } from '../../../lib/supabase/server';
import { revokeInvitationAction } from './actions';
import { InvitationForm } from './invitation-form';
import { MemberControls } from './member-controls';

type MembershipRole = Database['public']['Enums']['membership_role'];
type Invitation = Pick<
  Tables<'team_invitations'>,
  'accepted_at' | 'email' | 'expires_at' | 'id' | 'revoked_at' | 'role'
>;

export const dynamic = 'force-dynamic';

function roleLabel(role: MembershipRole): string {
  if (role === 'owner') return 'Owner';
  if (role === 'office') return 'Office staff';
  return 'Technician';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default async function TeamPage() {
  const context = await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const [membersResult, profilesResult] = await Promise.all([
    supabase
      .from('memberships')
      .select('id, user_id, role, status, joined_at, deactivated_at')
      .eq('tenant_id', context.tenantId)
      .order('created_at'),
    supabase
      .from('staff_profiles')
      .select('*')
      .eq('tenant_id', context.tenantId),
  ]);

  if (membersResult.error || profilesResult.error) {
    throw new Error('Unable to load the team directory.');
  }

  const profiles = new Map(
    (profilesResult.data ?? []).map(
      (profile) => [profile.membership_id, profile] as const,
    ),
  );
  const members = membersResult.data ?? [];
  let invitations: Invitation[] = [];

  if (context.role === 'owner') {
    const { data, error } = await supabase
      .from('team_invitations')
      .select('id, email, role, expires_at, accepted_at, revoked_at')
      .eq('tenant_id', context.tenantId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw new Error('Unable to load team invitations.');
    invitations = data ?? [];
  }

  return (
    <div className="workspace-page">
      <header className="workspace-heading">
        <div>
          <p className="workspace-kicker">People & access</p>
          <h1>Team</h1>
          <p>Roles, skills, service areas, and availability in one place.</p>
        </div>
      </header>

      {context.role === 'owner' ? (
        <section className="team-panel">
          <div className="team-panel-heading">
            <div>
              <h2>Invite a team member</h2>
              <p>
                Links expire after 72 hours and only work for the invited,
                verified email address. The invitee chooses their own password;
                passwords are never sent by CrewFlow.
              </p>
            </div>
          </div>
          <InvitationForm />
        </section>
      ) : null}

      <section className="team-panel">
        <div className="team-panel-heading">
          <div>
            <h2>Team directory</h2>
            <p>{members.length} current and historical team records.</p>
          </div>
        </div>
        <div className="team-list">
          {members.map((member) => {
            const profile = profiles.get(member.id);
            return (
              <article className="team-member-card" key={member.id}>
                <div className="team-member-summary">
                  <div className="team-avatar" aria-hidden="true">
                    {(profile?.full_name ?? 'Team member')
                      .split(' ')
                      .slice(0, 2)
                      .map((part) => part[0])
                      .join('')
                      .toUpperCase()}
                  </div>
                  <div>
                    <h3>{profile?.full_name ?? 'Team member'}</h3>
                    <p>
                      {roleLabel(member.role)} ·{' '}
                      <span className={`status-${member.status}`}>
                        {member.status}
                      </span>
                    </p>
                    {profile?.skills.length ? (
                      <p className="team-skills">
                        {profile.skills.join(' · ')}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="team-member-actions">
                  {member.status === 'active' ? (
                    <Link
                      className="secondary-button"
                      href={`/app/team/${member.id}`}
                    >
                      Edit staff details
                    </Link>
                  ) : (
                    <small>
                      Deactivated{' '}
                      {member.deactivated_at
                        ? formatDate(member.deactivated_at)
                        : ''}
                    </small>
                  )}
                  {context.role === 'owner' && member.status === 'active' ? (
                    <MemberControls
                      canDeactivate={member.user_id !== context.userId}
                      membershipId={member.id}
                      role={member.role}
                    />
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {context.role === 'owner' ? (
        <section className="team-panel">
          <div className="team-panel-heading">
            <div>
              <h2>Recent invitations</h2>
              <p>
                Pending means the CrewFlow invitation is not accepted yet.
                Vercel deployment access does not activate a team member.
              </p>
            </div>
          </div>
          {invitations.length ? (
            <div className="resource-table-wrap">
              <table className="resource-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Expires</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((invitation) => {
                    const expired =
                      new Date(invitation.expires_at) <= new Date();
                    const status = invitation.accepted_at
                      ? 'Accepted'
                      : invitation.revoked_at
                        ? 'Revoked'
                        : expired
                          ? 'Expired'
                          : 'Pending';
                    return (
                      <tr key={invitation.id}>
                        <td>{invitation.email}</td>
                        <td>{roleLabel(invitation.role)}</td>
                        <td>
                          <span className="status-badge">{status}</span>
                        </td>
                        <td>{formatDate(invitation.expires_at)}</td>
                        <td>
                          {status === 'Pending' ? (
                            <form action={revokeInvitationAction}>
                              <input
                                name="invitationId"
                                type="hidden"
                                value={invitation.id}
                              />
                              <button className="danger-button" type="submit">
                                Revoke
                              </button>
                            </form>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <h3>No invitations yet</h3>
              <p>Create the first secure invitation link above.</p>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
