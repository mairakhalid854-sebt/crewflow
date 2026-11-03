import Link from 'next/link';

import { requireTenantContext } from '../../../../lib/auth/tenant-context';
import { teamSkillSuggestions } from '../../../../lib/skill-suggestions';
import { createClient } from '../../../../lib/supabase/server';
import { ServiceForm } from '../service-form';

export default async function NewServicePage() {
  const context = await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const skillSuggestions = await teamSkillSuggestions(
    supabase,
    context.tenantId,
  );

  return (
    <div className="workspace-page resource-editor-page">
      <Link className="back-link" href="/app/services">
        ← Services
      </Link>
      <header>
        <p className="workspace-kicker">New service</p>
        <h1>Add a service</h1>
        <p>Set reusable pricing and scheduling defaults.</p>
      </header>
      <ServiceForm skillSuggestions={skillSuggestions} />
    </div>
  );
}
