import Link from 'next/link';

import { requireTenantContext } from '../../../../lib/auth/tenant-context';
import { createClient } from '../../../../lib/supabase/server';
import { JobForm } from '../job-form';

export const dynamic = 'force-dynamic';

export default async function NewJobPage() {
  const context = await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const [customersResult, servicesResult, membersResult, profilesResult] =
    await Promise.all([
      supabase
        .from('customers')
        .select('id, first_name, last_name')
        .eq('tenant_id', context.tenantId)
        .is('archived_at', null)
        .order('last_name'),
      supabase
        .from('services')
        .select('id, name')
        .eq('tenant_id', context.tenantId)
        .eq('is_enabled', true)
        .is('archived_at', null)
        .order('name'),
      supabase
        .from('memberships')
        .select('id')
        .eq('tenant_id', context.tenantId)
        .eq('role', 'technician')
        .eq('status', 'active'),
      supabase
        .from('staff_profiles')
        .select('membership_id, full_name')
        .eq('tenant_id', context.tenantId),
    ]);

  if (
    customersResult.error ||
    servicesResult.error ||
    membersResult.error ||
    profilesResult.error
  ) {
    throw new Error('Job form options could not be loaded.');
  }

  const activeTechnicians = new Set(
    (membersResult.data ?? []).map((membership) => membership.id),
  );
  const customers = (customersResult.data ?? []).map((customer) => ({
    id: customer.id,
    label: `${customer.first_name} ${customer.last_name}`,
  }));
  const services = (servicesResult.data ?? []).map((service) => ({
    id: service.id,
    label: service.name,
  }));
  const technicians = (profilesResult.data ?? [])
    .filter((profile) => activeTechnicians.has(profile.membership_id))
    .map((profile) => ({
      id: profile.membership_id,
      label: profile.full_name,
    }));

  return (
    <div className="workspace-page resource-editor-page">
      <Link className="back-link" href="/app/jobs">
        ← Back to jobs
      </Link>
      <header>
        <p className="workspace-kicker">New work order</p>
        <h1>Create job</h1>
        <p>
          Connect customer work to a service, technician, and local schedule.
        </p>
      </header>

      {customers.length === 0 ? (
        <section className="empty-state">
          <h2>Add a customer first</h2>
          <p>A job must belong to an active customer.</p>
          <Link
            className="primary-button empty-state-action"
            href="/app/customers/new"
          >
            Add customer
          </Link>
        </section>
      ) : (
        <JobForm
          customers={customers}
          services={services}
          technicians={technicians}
          timeZone={context.timeZone}
        />
      )}
    </div>
  );
}
