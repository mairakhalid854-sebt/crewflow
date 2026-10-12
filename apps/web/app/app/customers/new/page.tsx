import Link from 'next/link';

import { requireTenantContext } from '../../../../lib/auth/tenant-context';
import { CustomerForm } from '../customer-form';

export default async function NewCustomerPage() {
  await requireTenantContext(['owner', 'office']);

  return (
    <div className="workspace-page resource-editor-page">
      <Link className="back-link" href="/app/customers">
        ← Customers
      </Link>
      <header>
        <p className="workspace-kicker">New customer</p>
        <h1>Add a customer</h1>
        <p>Only the first and last name are required.</p>
      </header>
      <CustomerForm />
    </div>
  );
}
