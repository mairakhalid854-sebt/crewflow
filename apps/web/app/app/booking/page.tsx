import Link from 'next/link';

import { appUrl } from '../../../lib/app-url';
import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { normalizeBookingSlug } from '../../../lib/booking/public-booking';
import { createClient } from '../../../lib/supabase/server';
import { setServiceBookingAction } from './actions';
import { BookingDecisionButtons, BookingPageForm } from './booking-forms';
import './booking.css';

export const dynamic = 'force-dynamic';

function formatWhen(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

export default async function BookingPage() {
  const context = await requireTenantContext(['owner', 'office']);
  const isOwner = context.role === 'owner';
  const supabase = await createClient();

  const [pageResult, servicesResult, requestsResult] = await Promise.all([
    supabase
      .from('booking_pages')
      .select('slug, enabled, headline, intro')
      .eq('tenant_id', context.tenantId)
      .maybeSingle(),
    supabase
      .from('services')
      .select('id, name, unit_price_cents, online_booking_enabled')
      .eq('tenant_id', context.tenantId)
      .is('archived_at', null)
      .eq('is_enabled', true)
      .order('name'),
    supabase
      .from('booking_requests')
      .select(
        'id, job_id, status, requested_start_at, hold_expires_at, customer_note, created_at, customers(first_name, last_name, email, phone), services(name), jobs(title)',
      )
      .eq('tenant_id', context.tenantId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  if (pageResult.error || servicesResult.error || requestsResult.error) {
    throw new Error('Online booking could not be loaded.');
  }

  const page = pageResult.data;
  const services = servicesResult.data ?? [];
  const requests = requestsResult.data ?? [];
  const pending = requests.filter((request) => request.status === 'pending');
  const recent = requests.filter((request) => request.status !== 'pending');
  const bookable = services.filter((service) => service.online_booking_enabled);
  const zone = context.timeZone;

  return (
    <div className="workspace-page resource-editor-page settings-page booking-admin">
      <header className="workspace-heading">
        <div>
          <p className="workspace-kicker">Grow your business</p>
          <h1>Online booking</h1>
          <p>
            Let customers book from Google, your website, or social media, day
            or night. Requests hold the time for you until you confirm.
          </p>
        </div>
        {page?.enabled ? (
          <Link
            className="secondary-button"
            href={`/book/${page.slug}`}
            target="_blank"
          >
            View booking page
          </Link>
        ) : null}
      </header>

      <section className="settings-section" aria-labelledby="booking-requests">
        <div className="settings-section-heading">
          <h2 id="booking-requests">
            Requests waiting for you{' '}
            <span className="status-badge">{pending.length}</span>
          </h2>
          <p>
            Each request already created a customer and a new job. Apply the
            requested time to put it on the schedule with the suggested
            technician, or dismiss it.
          </p>
        </div>
        {pending.length === 0 ? (
          <div className="empty-state">
            <h2>No requests right now</h2>
            <p>New online bookings will show up here and in your email.</p>
          </div>
        ) : (
          <ul className="booking-request-list">
            {pending.map((request) => {
              const customer = request.customers;
              const expired = new Date(request.hold_expires_at) < new Date();
              return (
                <li className="booking-request" key={request.id}>
                  <div>
                    <strong>
                      {customer
                        ? `${customer.first_name} ${customer.last_name}`
                        : 'Customer'}
                    </strong>
                    <span>
                      {request.services?.name ?? request.jobs?.title} ·{' '}
                      {formatWhen(request.requested_start_at, zone)}
                    </span>
                    <span className="booking-request-contact">
                      {[customer?.email, customer?.phone]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    {request.customer_note ? (
                      <q>{request.customer_note}</q>
                    ) : null}
                    <span
                      className={
                        expired ? 'booking-hold-expired' : 'booking-hold'
                      }
                    >
                      {expired
                        ? 'Hold expired: the time may have been offered again.'
                        : `Time held until ${formatWhen(request.hold_expires_at, zone)}`}
                    </span>
                    <Link href={`/app/jobs/${request.job_id}`}>Open job</Link>
                  </div>
                  <BookingDecisionButtons requestId={request.id} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {isOwner ? (
        <>
          <BookingPageForm
            appUrl={appUrl()}
            page={page}
            suggestedSlug={normalizeBookingSlug(context.tenantName)}
          />

          <section
            className="settings-section"
            aria-labelledby="booking-services"
          >
            <div className="settings-section-heading">
              <h2 id="booking-services">Services customers can book</h2>
              <p>
                Only services you turn on here appear on the booking page. The
                price, length, and needed skills come from{' '}
                <Link href="/app/services">Services</Link>.
              </p>
            </div>
            {services.length === 0 ? (
              <div className="empty-state">
                <h2>No services yet</h2>
                <p>
                  <Link href="/app/services/new">Add a service</Link> first.
                </p>
              </div>
            ) : (
              <ul className="booking-service-list">
                {services.map((service) => (
                  <li key={service.id}>
                    <span>
                      <strong>{service.name}</strong>
                      <small>
                        {new Intl.NumberFormat('en-US', {
                          currency: 'USD',
                          style: 'currency',
                        }).format(service.unit_price_cents / 100)}
                      </small>
                    </span>
                    <form action={setServiceBookingAction}>
                      <input
                        name="serviceId"
                        type="hidden"
                        value={service.id}
                      />
                      <input
                        name="enabled"
                        type="hidden"
                        value={
                          service.online_booking_enabled ? 'false' : 'true'
                        }
                      />
                      <button
                        aria-pressed={service.online_booking_enabled}
                        className={
                          service.online_booking_enabled
                            ? 'primary-button'
                            : 'secondary-button'
                        }
                        type="submit"
                      >
                        {service.online_booking_enabled
                          ? 'Bookable online'
                          : 'Not bookable'}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            {page?.enabled && bookable.length === 0 ? (
              <p className="field-error" role="alert">
                Your booking page is on but no service is bookable, so customers
                will see an empty list.
              </p>
            ) : null}
          </section>

          <section
            className="settings-section"
            aria-labelledby="booking-google"
          >
            <div className="settings-section-heading">
              <h2 id="booking-google">Add a Book button on Google</h2>
              <p>Free, and it takes about two minutes.</p>
            </div>
            <ol className="booking-steps">
              <li>
                Open <strong>Google Business Profile</strong> (search &ldquo;my
                business&rdquo; on Google while signed in).
              </li>
              <li>
                Choose <strong>Edit profile</strong>, then{' '}
                <strong>Business information</strong>.
              </li>
              <li>
                Find <strong>Appointment links</strong> (or{' '}
                <strong>Bookings</strong>) and paste your booking link.
              </li>
              <li>
                Save. Google may take a few days to show the{' '}
                <strong>Book</strong> button on Search and Maps.
              </li>
            </ol>
          </section>
        </>
      ) : null}

      {recent.length > 0 ? (
        <section className="settings-section" aria-labelledby="booking-history">
          <div className="settings-section-heading">
            <h2 id="booking-history">Recent decisions</h2>
          </div>
          <div className="resource-table-wrap">
            <table className="resource-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Service</th>
                  <th>Requested time</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((request) => (
                  <tr key={request.id}>
                    <td>
                      <Link href={`/app/jobs/${request.job_id}`}>
                        {request.customers
                          ? `${request.customers.first_name} ${request.customers.last_name}`
                          : 'Customer'}
                      </Link>
                    </td>
                    <td>{request.services?.name ?? request.jobs?.title}</td>
                    <td>{formatWhen(request.requested_start_at, zone)}</td>
                    <td>
                      {request.status === 'applied' ? 'Scheduled' : 'Dismissed'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
