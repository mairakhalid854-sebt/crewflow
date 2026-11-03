import Link from 'next/link';

import { requireTenantContext } from '../../../lib/auth/tenant-context';
import {
  addCalendarDays,
  businessDateString,
  localDateTimeToIso,
  startOfCalendarWeek,
} from '../../../lib/date-time';
import { createClient } from '../../../lib/supabase/server';
import { jobStatusLabels } from '../jobs/job-status';

interface DispatchPageProps {
  readonly searchParams: Promise<{
    date?: string;
    q?: string;
    view?: string;
  }>;
}

function calendarLabel(value: string, includeYear = false): string {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    ...(includeYear ? { year: 'numeric' } : {}),
  }).format(new Date(`${value}T12:00:00.000Z`));
}

function timeLabel(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(new Date(value));
}

function dispatchHref(
  date: string,
  view: 'day' | 'week',
  search: string,
): string {
  const params = new URLSearchParams({ date, view });
  if (search) params.set('q', search);
  return `/app/dispatch?${params.toString()}`;
}

export const dynamic = 'force-dynamic';

export default async function DispatchPage({
  searchParams,
}: DispatchPageProps) {
  const context = await requireTenantContext(['owner', 'office']);
  const params = await searchParams;
  const today = businessDateString(new Date(), context.timeZone);
  const requestedDate = typeof params.date === 'string' ? params.date : '';
  const selectedDate = addCalendarDays(requestedDate, 0)
    ? requestedDate
    : today;
  const view = params.view === 'week' ? 'week' : 'day';
  const search =
    typeof params.q === 'string' ? params.q.trim().slice(0, 80) : '';
  const boardStart =
    view === 'week'
      ? (startOfCalendarWeek(selectedDate) ?? selectedDate)
      : selectedDate;
  const dayCount = view === 'week' ? 7 : 1;
  const dayDates = Array.from({ length: dayCount }, (_, index) =>
    addCalendarDays(boardStart, index),
  ).filter((date): date is string => Boolean(date));
  const boardEnd = addCalendarDays(boardStart, dayCount);
  const rangeStart = localDateTimeToIso(
    `${boardStart}T00:00`,
    context.timeZone,
  );
  const rangeEnd = boardEnd
    ? localDateTimeToIso(`${boardEnd}T00:00`, context.timeZone)
    : null;
  if (!rangeStart || !rangeEnd) throw new Error('Invalid dispatch date range.');

  const supabase = await createClient();
  const [
    membershipsResult,
    profilesResult,
    jobsResult,
    customersResult,
    servicesResult,
    timeOffResult,
  ] = await Promise.all([
    supabase
      .from('memberships')
      .select('id')
      .eq('tenant_id', context.tenantId)
      .eq('role', 'technician')
      .eq('status', 'active'),
    supabase
      .from('staff_profiles')
      .select('membership_id, full_name')
      .eq('tenant_id', context.tenantId)
      .order('full_name'),
    supabase
      .from('jobs')
      .select('*')
      .eq('tenant_id', context.tenantId)
      .is('archived_at', null)
      .order('scheduled_start_at')
      .limit(500),
    supabase
      .from('customers')
      .select('id, first_name, last_name')
      .eq('tenant_id', context.tenantId),
    supabase
      .from('services')
      .select('id, name')
      .eq('tenant_id', context.tenantId),
    supabase
      .from('staff_time_off')
      .select('*')
      .eq('tenant_id', context.tenantId)
      .is('cancelled_at', null)
      .lt('starts_at', rangeEnd)
      .gt('ends_at', rangeStart)
      .order('starts_at'),
  ]);

  if (
    membershipsResult.error ||
    profilesResult.error ||
    jobsResult.error ||
    customersResult.error ||
    servicesResult.error ||
    timeOffResult.error
  ) {
    throw new Error('Dispatch board could not be loaded.');
  }

  const activeIds = new Set(
    (membershipsResult.data ?? []).map((membership) => membership.id),
  );
  const technicians = (profilesResult.data ?? []).filter((profile) =>
    activeIds.has(profile.membership_id),
  );
  const customers = new Map(
    (customersResult.data ?? []).map((customer) => [
      customer.id,
      `${customer.first_name} ${customer.last_name}`,
    ]),
  );
  const services = new Map(
    (servicesResult.data ?? []).map((service) => [service.id, service.name]),
  );
  const needle = search.toLocaleLowerCase();
  const jobs = (jobsResult.data ?? []).filter((job) => {
    if (!needle) return true;
    return [
      job.title,
      customers.get(job.customer_id),
      job.service_id ? services.get(job.service_id) : null,
    ].some((value) => value?.toLocaleLowerCase().includes(needle));
  });
  const scheduledJobs = jobs.filter(
    (job) =>
      job.assigned_membership_id &&
      job.scheduled_start_at &&
      job.scheduled_end_at &&
      job.scheduled_start_at >= rangeStart &&
      job.scheduled_start_at < rangeEnd,
  );
  const needsDispatch = jobs.filter(
    (job) =>
      !['closed', 'cancelled'].includes(job.status) &&
      (!job.assigned_membership_id ||
        !job.scheduled_start_at ||
        !job.scheduled_end_at),
  );
  const previousDate = addCalendarDays(boardStart, -dayCount) ?? boardStart;
  const nextDate = addCalendarDays(boardStart, dayCount) ?? boardStart;
  const title =
    view === 'week'
      ? `${calendarLabel(boardStart)} – ${calendarLabel(dayDates.at(-1) ?? boardStart, true)}`
      : calendarLabel(boardStart, true);

  return (
    <div className="workspace-page dispatch-page">
      <header className="workspace-heading dispatch-heading">
        <div>
          <p className="workspace-kicker">Scheduling</p>
          <h1>Dispatch</h1>
          <p>Plan assignments in {context.timeZone.replaceAll('_', ' ')}.</p>
        </div>
        <Link className="primary-button" href="/app/jobs/new">
          Create job
        </Link>
      </header>

      <section className="dispatch-toolbar" aria-label="Dispatch controls">
        <div className="dispatch-navigation">
          <Link
            href={dispatchHref(previousDate, view, search)}
            aria-label="Previous period"
          >
            ←
          </Link>
          <Link href={dispatchHref(today, view, search)}>Today</Link>
          <Link
            href={dispatchHref(nextDate, view, search)}
            aria-label="Next period"
          >
            →
          </Link>
          <strong>{title}</strong>
        </div>
        <div className="dispatch-view-switcher" aria-label="Calendar view">
          <Link
            aria-current={view === 'day' ? 'page' : undefined}
            href={dispatchHref(selectedDate, 'day', search)}
          >
            Day
          </Link>
          <Link
            aria-current={view === 'week' ? 'page' : undefined}
            href={dispatchHref(selectedDate, 'week', search)}
          >
            Week
          </Link>
        </div>
      </section>

      <form className="resource-search dispatch-search" role="search">
        <input name="date" type="hidden" value={selectedDate} />
        <input name="view" type="hidden" value={view} />
        <label htmlFor="dispatch-search">Search dispatch board</label>
        <div>
          <input
            defaultValue={search}
            id="dispatch-search"
            name="q"
            placeholder="Job, customer, or service"
            type="search"
          />
          <button className="secondary-button" type="submit">
            Search
          </button>
        </div>
      </form>

      <div className="dispatch-layout">
        <aside className="dispatch-queue">
          <div>
            <p className="workspace-kicker">Queue</p>
            <h2>Needs dispatch</h2>
            <span>{needsDispatch.length}</span>
          </div>
          {needsDispatch.length === 0 ? (
            <p className="dispatch-empty">
              All open jobs are assigned and scheduled.
            </p>
          ) : (
            <ul>
              {needsDispatch.map((job) => (
                <li key={job.id}>
                  <Link href={`/app/jobs/${job.id}`}>
                    <strong>{job.title}</strong>
                    <span>{customers.get(job.customer_id) ?? 'Customer'}</span>
                    <small>
                      {!job.assigned_membership_id
                        ? 'Unassigned'
                        : 'Needs time'}
                    </small>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section
          className="dispatch-board"
          aria-label={`${view} dispatch board`}
        >
          <div
            className="dispatch-grid dispatch-grid-header"
            style={{ '--dispatch-days': dayCount } as React.CSSProperties}
          >
            <div>Technician</div>
            {dayDates.map((date) => (
              <div
                className={date === today ? 'is-today' : undefined}
                key={date}
              >
                {calendarLabel(date)}
              </div>
            ))}
          </div>

          {technicians.length === 0 ? (
            <div className="dispatch-empty dispatch-empty-board">
              Add an active technician to start dispatching work.
            </div>
          ) : (
            technicians.map((technician) => (
              <div
                className="dispatch-grid dispatch-technician-row"
                key={technician.membership_id}
                style={{ '--dispatch-days': dayCount } as React.CSSProperties}
              >
                <div className="dispatch-technician-name">
                  <strong>{technician.full_name}</strong>
                  <Link href={`/app/team/${technician.membership_id}`}>
                    Availability
                  </Link>
                </div>
                {dayDates.map((date) => {
                  const dayStart = localDateTimeToIso(
                    `${date}T00:00`,
                    context.timeZone,
                  );
                  const nextDay = addCalendarDays(date, 1);
                  const dayEnd = nextDay
                    ? localDateTimeToIso(`${nextDay}T00:00`, context.timeZone)
                    : null;
                  const cellJobs = scheduledJobs.filter(
                    (job) =>
                      job.assigned_membership_id === technician.membership_id &&
                      job.scheduled_start_at &&
                      businessDateString(
                        new Date(job.scheduled_start_at),
                        context.timeZone,
                      ) === date,
                  );
                  const cellTimeOff = (timeOffResult.data ?? []).filter(
                    (entry) =>
                      entry.membership_id === technician.membership_id &&
                      dayStart &&
                      dayEnd &&
                      entry.starts_at < dayEnd &&
                      entry.ends_at > dayStart,
                  );
                  return (
                    <div className="dispatch-day-cell" key={date}>
                      {cellTimeOff.map((entry) => (
                        <div className="dispatch-time-off" key={entry.id}>
                          Time off{entry.reason ? `: ${entry.reason}` : ''}
                        </div>
                      ))}
                      {cellJobs.map((job) => (
                        <Link
                          className={`dispatch-job-card dispatch-priority-${job.priority}`}
                          href={`/app/jobs/${job.id}`}
                          key={job.id}
                        >
                          <time>
                            {timeLabel(
                              job.scheduled_start_at!,
                              context.timeZone,
                            )}{' '}
                            –{' '}
                            {timeLabel(job.scheduled_end_at!, context.timeZone)}
                          </time>
                          <strong>{job.title}</strong>
                          <span>
                            {customers.get(job.customer_id) ?? 'Customer'}
                          </span>
                          <small>{jobStatusLabels[job.status]}</small>
                        </Link>
                      ))}
                      {cellJobs.length === 0 && cellTimeOff.length === 0 ? (
                        <span className="dispatch-open-slot">Open</span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
