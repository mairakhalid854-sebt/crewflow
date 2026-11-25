import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { createClient } from '../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

// Times use the company time zone, like every other workspace page; without
// it the server's UTC clock was shown.
function formatDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

function actionLabel(action: string): string {
  return action.replaceAll('.', ' › ').replaceAll('_', ' ');
}

function entityLabel(entityType: string): string {
  return entityType.replaceAll('_', ' ');
}

export default async function AuditPage() {
  const context = await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const [eventsResult, membersResult, profilesResult] = await Promise.all([
    supabase
      .from('audit_events')
      .select('id, action, entity_type, entity_id, occurred_at, actor_user_id')
      .eq('tenant_id', context.tenantId)
      .order('occurred_at', { ascending: false })
      .limit(100),
    supabase
      .from('memberships')
      .select('id, user_id')
      .eq('tenant_id', context.tenantId),
    supabase
      .from('staff_profiles')
      .select('membership_id, full_name')
      .eq('tenant_id', context.tenantId),
  ]);

  const { data, error } = eventsResult;
  if (error) throw new Error('Unable to load the audit trail.');

  // Names are a convenience: if they cannot be loaded the trail still shows,
  // with the generic "Team member" label.
  const nameByMembership = new Map(
    (profilesResult.data ?? []).map((profile) => [
      profile.membership_id,
      profile.full_name,
    ]),
  );
  const nameByUser = new Map<string, string>();
  for (const member of membersResult.data ?? []) {
    const name = nameByMembership.get(member.id)?.trim();
    if (member.user_id && name) nameByUser.set(member.user_id, name);
  }

  function actorLabel(actorUserId: string | null): string {
    if (!actorUserId) return 'System';
    return nameByUser.get(actorUserId) ?? 'Team member';
  }

  return (
    <div className="workspace-page">
      <header className="workspace-heading">
        <div>
          <p className="workspace-kicker">Accountability</p>
          <h1>Audit trail</h1>
          <p>
            Recent security and record changes for this workspace. Times are in{' '}
            {context.timeZone}.
          </p>
        </div>
      </header>

      {data?.length ? (
        <div className="resource-table-wrap">
          <table className="resource-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Actor</th>
              </tr>
            </thead>
            <tbody>
              {data.map((event) => (
                <tr key={event.id}>
                  <td>{formatDate(event.occurred_at, context.timeZone)}</td>
                  <td>{actionLabel(event.action)}</td>
                  <td>{entityLabel(event.entity_type)}</td>
                  <td>{actorLabel(event.actor_user_id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <section className="empty-state">
          <h2>No audit events yet</h2>
          <p>
            New customer, service, invitation, and team changes appear here.
          </p>
        </section>
      )}
    </div>
  );
}
