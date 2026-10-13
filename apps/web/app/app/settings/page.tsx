import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { createClient } from '../../../lib/supabase/server';

import { CompanySettingsForm } from './company-settings-form';

export const dynamic = 'force-dynamic';

export default async function CompanySettingsPage() {
  const context = await requireTenantContext(['owner']);
  const supabase = await createClient();
  const [tenantResult, settingsResult, hoursResult] = await Promise.all([
    supabase.from('tenants').select('*').eq('id', context.tenantId).single(),
    supabase
      .from('tenant_settings')
      .select('*')
      .eq('tenant_id', context.tenantId)
      .single(),
    supabase
      .from('business_hours')
      .select('*')
      .eq('tenant_id', context.tenantId)
      .order('day_of_week'),
  ]);

  if (
    tenantResult.error ||
    settingsResult.error ||
    hoursResult.error ||
    !tenantResult.data ||
    !settingsResult.data
  ) {
    throw new Error('Company settings could not be loaded.');
  }

  return (
    <div className="workspace-page resource-editor-page settings-page">
      <header className="workspace-heading">
        <div>
          <p className="workspace-kicker">Workspace administration</p>
          <h1>Company settings</h1>
          <p>
            Manage business identity, operating hours, tax, and automation
            policy.
          </p>
        </div>
      </header>
      <CompanySettingsForm
        businessHours={hoursResult.data ?? []}
        settings={settingsResult.data}
        tenant={tenantResult.data}
      />
    </div>
  );
}
