import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { requireTenantContext } from '../../../../lib/auth/tenant-context';
import { createClient } from '../../../../lib/supabase/server';
import { archiveCustomerAction } from '../actions';
import { ArchiveCustomerButton } from '../archive-customer-button';
import { CustomerForm } from '../customer-form';

interface CustomerDetailPageProps {
  readonly params: Promise<{ id: string }>;
}

export default async function CustomerDetailPage({
  params,
}: CustomerDetailPageProps) {
  const context = await requireTenantContext(['owner', 'office']);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data: customer, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', context.tenantId)
    .is('archived_at', null)
    .maybeSingle();

  if (error) throw new Error('Customer could not be loaded.');
  if (!customer) notFound();

  return (
    <div className="workspace-page resource-editor-page">
      <Link className="back-link" href="/app/customers">
        ← Customers
      </Link>
      <header className="resource-detail-heading">
        <div>
          <p className="workspace-kicker">Customer record</p>
          <h1>
            {customer.first_name} {customer.last_name}
          </h1>
          <p>Update contact details, address, notes, and consent.</p>
        </div>
        <ArchiveCustomerButton
          action={archiveCustomerAction}
          customerId={customer.id}
        />
      </header>
      <CustomerForm customer={customer} />
    </div>
  );
}
