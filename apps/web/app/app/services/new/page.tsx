import Link from 'next/link';

import { requireTenantContext } from '../../../../lib/auth/tenant-context';
import { ServiceForm } from '../service-form';

export default async function NewServicePage() {
  await requireTenantContext(['owner', 'office']);

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
      <ServiceForm />
    </div>
  );
}
