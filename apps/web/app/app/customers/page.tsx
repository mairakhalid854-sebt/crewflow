import Link from 'next/link';

import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { createClient } from '../../../lib/supabase/server';

interface CustomersPageProps {
  readonly searchParams: Promise<{ q?: string }>;
}

export default async function CustomersPage({
  searchParams,
}: CustomersPageProps) {
  const context = await requireTenantContext(['owner', 'office']);
  const { q } = await searchParams;
  const search = typeof q === 'string' ? q.trim().slice(0, 80) : '';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('customers')
    .select('id, first_name, last_name, email, phone, city, state_code')
    .eq('tenant_id', context.tenantId)
    .is('archived_at', null)
    .order('last_name')
    .order('first_name')
    .limit(200);

  if (error) throw new Error('Customers could not be loaded.');

  const needle = search.toLocaleLowerCase();
  const customers = needle
    ? data.filter((customer) =>
        [
          customer.first_name,
          customer.last_name,
          customer.email,
          customer.phone,
          customer.city,
        ].some((value) => value?.toLocaleLowerCase().includes(needle)),
      )
    : data;

  return (
    <div className="workspace-page">
      <header className="workspace-heading">
        <div>
          <p className="workspace-kicker">Customer directory</p>
          <h1>Customers</h1>
          <p>
            Contact details, service addresses, consent, and internal notes.
          </p>
        </div>
        <Link className="primary-button" href="/app/customers/new">
          Add customer
        </Link>
      </header>

      <form className="resource-search" role="search">
        <label htmlFor="customer-search">Search customers</label>
        <div>
          <input
            defaultValue={search}
            id="customer-search"
            name="q"
            placeholder="Name, email, phone, or city"
            type="search"
          />
          <button className="secondary-button" type="submit">
            Search
          </button>
        </div>
      </form>

      {customers.length === 0 ? (
        <section className="empty-state">
          <h2>{search ? 'No matching customers' : 'No customers yet'}</h2>
          <p>
            {search
              ? 'Try a different name, email, phone number, or city.'
              : 'Add your first customer to begin building the service history.'}
          </p>
        </section>
      ) : (
        <div className="resource-table-wrap">
          <table className="resource-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Location</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td>
                    <strong>
                      {customer.first_name} {customer.last_name}
                    </strong>
                  </td>
                  <td>{customer.email ?? customer.phone ?? '—'}</td>
                  <td>
                    {[customer.city, customer.state_code]
                      .filter(Boolean)
                      .join(', ') || '—'}
                  </td>
                  <td>
                    <Link href={`/app/customers/${customer.id}`}>View</Link>
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
