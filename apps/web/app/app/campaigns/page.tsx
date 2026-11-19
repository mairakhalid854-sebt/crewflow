import Link from 'next/link';

import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { createClient } from '../../../lib/supabase/server';
import {
  CampaignDraft,
  CampaignSettingsForm,
  CreateCampaignButtons,
} from './campaign-forms';
import './campaigns.css';

export const dynamic = 'force-dynamic';

function formatDate(value: string | null, timeZone: string): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeZone,
  }).format(new Date(value));
}

export default async function CampaignsPage() {
  const context = await requireTenantContext(['owner']);
  const supabase = await createClient();

  const [settingsResult, campaignsResult, statsResult, tenantResult] =
    await Promise.all([
      supabase
        .from('weather_campaign_settings')
        .select('enabled, auto_send, heat_threshold_f, cold_threshold_f')
        .eq('tenant_id', context.tenantId)
        .maybeSingle(),
      supabase
        .from('weather_campaigns')
        .select(
          'id, kind, source, status, subject, body, audience_count, queued_count, forecast_date, forecast_temp_f, created_at, approved_at',
        )
        .eq('tenant_id', context.tenantId)
        .order('created_at', { ascending: false })
        .limit(30),
      supabase.rpc('get_weather_campaign_stats', {
        target_tenant_id: context.tenantId,
      }),
      supabase
        .from('tenants')
        .select('street_address, city, state_code, postal_code')
        .eq('id', context.tenantId)
        .single(),
    ]);

  if (settingsResult.error || campaignsResult.error || tenantResult.error) {
    throw new Error('Campaigns could not be loaded.');
  }

  const campaigns = campaignsResult.data ?? [];
  const drafts = campaigns.filter((campaign) => campaign.status === 'draft');
  const history = campaigns.filter((campaign) => campaign.status !== 'draft');
  const stats = new Map(
    (statsResult.data ?? []).map((row) => [row.campaign_id, row]),
  );
  const tenant = tenantResult.data;
  const addressComplete = Boolean(
    tenant.street_address &&
    tenant.city &&
    tenant.state_code &&
    tenant.postal_code,
  );

  return (
    <div className="workspace-page resource-editor-page settings-page campaigns-admin">
      <header className="workspace-heading">
        <div>
          <p className="workspace-kicker">Grow your business</p>
          <h1>Weather campaigns</h1>
          <p>
            Before a heat wave or a freeze, remind past customers to book a
            check-up. Busy season starts before the phones ring.
          </p>
        </div>
      </header>

      {!addressComplete ? (
        <p className="form-message-error" role="alert">
          Add your full business address in{' '}
          <Link href="/app/settings">Settings</Link>. It is needed for the
          forecast and is required in every marketing email.
        </p>
      ) : null}

      <section className="settings-section" aria-labelledby="campaign-drafts">
        <div className="settings-section-heading">
          <h2 id="campaign-drafts">Ready to review ({drafts.length})</h2>
          <p>
            Sent only to past customers who agreed to marketing email, have no
            open job, and were not emailed in the last 3 weeks.
          </p>
        </div>
        {drafts.length === 0 ? (
          <div className="empty-state">
            <h2>No drafts right now</h2>
            <p>
              Drafts appear here when the forecast turns. You can also start one
              now.
            </p>
          </div>
        ) : (
          drafts.map((campaign) => (
            <article className="campaign-card" key={campaign.id}>
              <header>
                <strong>
                  {campaign.kind === 'heat' ? '☀️ Heat wave' : '❄️ Freeze'}
                </strong>
                <span>
                  {campaign.forecast_date && campaign.forecast_temp_f !== null
                    ? `${campaign.forecast_temp_f}°F forecast for ${campaign.forecast_date}`
                    : 'Started by you'}
                </span>
              </header>
              <CampaignDraft campaign={campaign} />
            </article>
          ))
        )}
        <CreateCampaignButtons />
      </section>

      <CampaignSettingsForm settings={settingsResult.data} />

      {history.length > 0 ? (
        <section
          className="settings-section"
          aria-labelledby="campaign-history"
        >
          <div className="settings-section-heading">
            <h2 id="campaign-history">History</h2>
          </div>
          <div className="resource-table-wrap">
            <table className="resource-table">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Date</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {history.map((campaign) => {
                  const row = stats.get(campaign.id);
                  return (
                    <tr key={campaign.id}>
                      <td>{campaign.subject}</td>
                      <td>
                        {formatDate(
                          campaign.approved_at ?? campaign.created_at,
                          context.timeZone,
                        )}
                      </td>
                      <td>
                        {campaign.status === 'cancelled'
                          ? 'Discarded'
                          : `${row?.delivered ?? 0} delivered${
                              row?.waiting ? `, ${row.waiting} sending` : ''
                            }${row?.failed ? `, ${row.failed} not sent` : ''}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
