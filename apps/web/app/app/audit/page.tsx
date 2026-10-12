import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { createClient } from '../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function actionLabel(action: string): string {
  return action.replaceAll('.', ' › ').replaceAll('_', ' ');
}

export default async function AuditPage() {
  const context = await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('audit_events')
    .select('id, action, entity_type, entity_id, occurred_at, actor_user_id')
    .eq('tenant_id', context.tenantId)
    .order('occurred_at', { ascending: false })
    .limit(100);

  if (error) throw new Error('Unable to load the audit trail.');

  return (
    <div className="workspace-page">
      <header className="workspace-heading">
        <div>
          <p className="workspace-kicker">Accountability</p>
          <h1>Audit trail</h1>
          <p>Recent security and record changes for this workspace.</p>
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
                  <td>{formatDate(event.occurred_at)}</td>
                  <td>{actionLabel(event.action)}</td>
                  <td>{event.entity_type}</td>
                  <td>{event.actor_user_id ? 'Team member' : 'System'}</td>
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
