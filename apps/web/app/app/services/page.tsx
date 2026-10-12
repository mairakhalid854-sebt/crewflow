import Link from 'next/link';

import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { createClient } from '../../../lib/supabase/server';

interface ServicesPageProps {
  readonly searchParams: Promise<{ q?: string }>;
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    style: 'currency',
  }).format(cents / 100);
}

export default async function ServicesPage({
  searchParams,
}: ServicesPageProps) {
  const context = await requireTenantContext();
  const { q } = await searchParams;
  const search = typeof q === 'string' ? q.trim().slice(0, 80) : '';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('services')
    .select(
      'id, name, description, unit_price_cents, default_duration_minutes, is_enabled',
    )
    .eq('tenant_id', context.tenantId)
    .is('archived_at', null)
    .order('name')
    .limit(200);

  if (error) throw new Error('Services could not be loaded.');

  const needle = search.toLocaleLowerCase();
  const services = needle
    ? data.filter((service) =>
        [service.name, service.description].some((value) =>
          value?.toLocaleLowerCase().includes(needle),
        ),
      )
    : data;

  return (
    <div className="workspace-page">
      <header className="workspace-heading">
        <div>
          <p className="workspace-kicker">Service catalog</p>
          <h1>Services</h1>
          <p>Reusable pricing, duration, availability, and tax defaults.</p>
        </div>
        {context.role !== 'technician' ? (
          <Link className="primary-button" href="/app/services/new">
            Add service
          </Link>
        ) : null}
      </header>

      <form className="resource-search" role="search">
        <label htmlFor="service-search">Search services</label>
        <div>
          <input
            defaultValue={search}
            id="service-search"
            name="q"
            placeholder="Name or description"
            type="search"
          />
          <button className="secondary-button" type="submit">
            Search
          </button>
        </div>
      </form>

      {services.length === 0 ? (
        <section className="empty-state">
          <h2>{search ? 'No matching services' : 'No services yet'}</h2>
          <p>
            {search
              ? 'Try a different service name or description.'
              : 'Create a service so estimates and jobs can reuse its defaults.'}
          </p>
        </section>
      ) : (
        <div className="resource-table-wrap">
          <table className="resource-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Price</th>
                <th>Duration</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {services.map((service) => (
                <tr key={service.id}>
                  <td>
                    <strong>{service.name}</strong>
                  </td>
                  <td>{formatMoney(service.unit_price_cents)}</td>
                  <td>{service.default_duration_minutes} min</td>
                  <td>
                    <span
                      className={`status-badge ${service.is_enabled ? 'status-enabled' : ''}`}
                    >
                      {service.is_enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td>
                    <Link href={`/app/services/${service.id}`}>View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
