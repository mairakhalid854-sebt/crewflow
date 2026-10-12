import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { requireTenantContext } from '../../../../lib/auth/tenant-context';
import { createClient } from '../../../../lib/supabase/server';
import { archiveServiceAction } from '../actions';
import { ArchiveServiceButton } from '../archive-service-button';
import { ServiceForm } from '../service-form';

interface ServiceDetailPageProps {
  readonly params: Promise<{ id: string }>;
}

export default async function ServiceDetailPage({
  params,
}: ServiceDetailPageProps) {
  const context = await requireTenantContext(['owner', 'office']);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data: service, error } = await supabase
    .from('services')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', context.tenantId)
    .is('archived_at', null)
    .maybeSingle();

  if (error) throw new Error('Service could not be loaded.');
  if (!service) notFound();

  return (
    <div className="workspace-page resource-editor-page">
      <Link className="back-link" href="/app/services">
        ← Services
      </Link>
      <header className="resource-detail-heading">
        <div>
          <p className="workspace-kicker">Service record</p>
          <h1>{service.name}</h1>
          <p>Update pricing, duration, tax behavior, and availability.</p>
        </div>
        <ArchiveServiceButton
          action={archiveServiceAction}
          serviceId={service.id}
        />
      </header>
      <ServiceForm service={service} />
    </div>
  );
}
