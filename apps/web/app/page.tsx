import type { DashboardJobSummary, JobStatus } from '@crewflow/types';

const demoTenantId = '00000000-0000-4000-8000-000000000001';

const jobs: readonly DashboardJobSummary[] = [
  {
    customerName: 'Olivia Carter',
    id: 'job-1048',
    serviceName: 'AC diagnostic',
    startsAt: '9:00 AM',
    status: 'in_progress',
    technicianName: 'Marcus Lee',
    tenantId: demoTenantId,
  },
  {
    customerName: 'Noah Williams',
    id: 'job-1049',
    serviceName: 'Water heater repair',
    startsAt: '11:30 AM',
    status: 'scheduled',
    technicianName: 'Priya Shah',
    tenantId: demoTenantId,
  },
  {
    customerName: 'Mia Thompson',
    id: 'job-1050',
    serviceName: 'Seasonal tune-up',
    startsAt: '2:00 PM',
    status: 'accepted',
    technicianName: null,
    tenantId: demoTenantId,
  },
];

const statusLabels: Record<JobStatus, string> = {
  accepted: 'Needs dispatch',
  cancelled: 'Cancelled',
  closed: 'Closed',
  completed: 'Completed',
  in_progress: 'In progress',
  new: 'New',
  quoted: 'Quoted',
  scheduled: 'Scheduled',
};

const navItems = [
  'Overview',
  'Jobs',
  'Schedule',
  'Customers',
  'Services',
  'Team',
];

export interface DashboardPreviewProps {
  readonly tenantName?: string;
  readonly userName?: string;
}

export function DashboardPreview({
  tenantName = 'BrightSide HVAC',
  userName = 'Alex Johnson',
}: DashboardPreviewProps) {
  const firstName = userName.split(' ')[0] ?? userName;
  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <a className="brand" href="#main-content" aria-label="CrewFlow home">
          <span className="brand-mark" aria-hidden="true">
            C
          </span>
          <span>CrewFlow</span>
        </a>

        <nav className="nav-list">
          {navItems.map((item, index) => (
            <a
              className={index === 0 ? 'nav-item active' : 'nav-item'}
              href={`#${item.toLowerCase()}`}
              key={item}
            >
              <span className="nav-dot" aria-hidden="true" />
              {item}
            </a>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="help-icon" aria-hidden="true">
            ?
          </div>
          <div>
            <strong>Need a hand?</strong>
            <span>Open the setup guide</span>
          </div>
        </div>
      </aside>

      <section className="workspace" id="main-content">
        <header className="topbar">
          <label className="search">
            <span aria-hidden="true">⌕</span>
            <span className="sr-only">Search CrewFlow</span>
            <input
              type="search"
              placeholder="Search jobs, customers, invoices…"
            />
            <kbd>⌘ K</kbd>
          </label>
          <div className="topbar-actions">
            <button
              className="icon-button"
              type="button"
              aria-label="Notifications"
            >
              <span aria-hidden="true">◌</span>
              <span className="notification-dot" />
            </button>
            <button
              className="account"
              type="button"
              aria-label="Open account menu"
            >
              <span className="avatar">AJ</span>
              <span className="account-copy">
                <strong>{userName}</strong>
                <span>Owner · {tenantName}</span>
              </span>
              <span aria-hidden="true">⌄</span>
            </button>
          </div>
        </header>

        <div className="content">
          <section className="welcome-row">
            <div>
              <p className="eyebrow">MONDAY, OCTOBER 12</p>
              <h1>Good morning, {firstName}</h1>
              <p>Here’s what needs your attention across the crew today.</p>
            </div>
            <button className="primary-button" type="button">
              <span aria-hidden="true">＋</span> New job
            </button>
          </section>

          <section className="metrics" aria-label="Business summary">
            <article className="metric-card">
              <div className="metric-top">
                <span>Today’s jobs</span>
                <span className="metric-icon blue">↗</span>
              </div>
              <strong>8</strong>
              <p>
                <span className="positive">+2</span> from last Monday
              </p>
            </article>
            <article className="metric-card">
              <div className="metric-top">
                <span>Unassigned</span>
                <span className="metric-icon amber">!</span>
              </div>
              <strong>3</strong>
              <p>One begins within 3 hours</p>
            </article>
            <article className="metric-card">
              <div className="metric-top">
                <span>Open invoices</span>
                <span className="metric-icon violet">$</span>
              </div>
              <strong>$6,840</strong>
              <p>$1,240 is overdue</p>
            </article>
            <article className="metric-card">
              <div className="metric-top">
                <span>Collected this month</span>
                <span className="metric-icon green">✓</span>
              </div>
              <strong>$24,560</strong>
              <p>
                <span className="positive">+12.4%</span> month over month
              </p>
            </article>
          </section>

          <div className="dashboard-grid">
            <section
              className="panel jobs-panel"
              aria-labelledby="today-heading"
            >
              <div className="panel-header">
                <div>
                  <h2 id="today-heading">Today’s jobs</h2>
                  <p>Live schedule for the field team</p>
                </div>
                <a href="#schedule">
                  View schedule <span aria-hidden="true">→</span>
                </a>
              </div>
              <div
                className="jobs-table"
                role="table"
                aria-label="Today's scheduled jobs"
              >
                <div className="table-head table-row" role="row">
                  <span role="columnheader">Time</span>
                  <span role="columnheader">Customer</span>
                  <span role="columnheader">Technician</span>
                  <span role="columnheader">Status</span>
                </div>
                {jobs.map((job) => (
                  <div className="table-row" role="row" key={job.id}>
                    <span className="job-time" role="cell">
                      {job.startsAt}
                    </span>
                    <span className="customer-cell" role="cell">
                      <strong>{job.customerName}</strong>
                      <small>{job.serviceName}</small>
                    </span>
                    <span
                      role="cell"
                      className={job.technicianName ? '' : 'unassigned'}
                    >
                      {job.technicianName ?? 'Assign tech'}
                    </span>
                    <span role="cell">
                      <span className={`status status-${job.status}`}>
                        {statusLabels[job.status]}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              <div className="panel-note">
                <span aria-hidden="true">●</span> Demo data only — secure tenant
                data arrives in Phase 1.
              </div>
            </section>

            <aside className="right-column">
              <section
                className="panel attention-panel"
                aria-labelledby="attention-heading"
              >
                <div className="panel-header compact">
                  <div>
                    <h2 id="attention-heading">Needs attention</h2>
                    <p>2 items</p>
                  </div>
                </div>
                <article className="attention-item">
                  <span className="attention-mark amber">!</span>
                  <div>
                    <strong>Job needs a technician</strong>
                    <p>Mia Thompson · 2:00 PM</p>
                    <button type="button">Review job</button>
                  </div>
                </article>
                <article className="attention-item">
                  <span className="attention-mark blue">↗</span>
                  <div>
                    <strong>Quote ready to review</strong>
                    <p>Draft prepared for job #1046</p>
                    <button type="button">Open draft</button>
                  </div>
                </article>
              </section>

              <section
                className="panel crew-panel"
                aria-labelledby="crew-heading"
              >
                <div className="panel-header compact">
                  <div>
                    <h2 id="crew-heading">Crew status</h2>
                    <p>4 of 5 available</p>
                  </div>
                </div>
                <div className="crew-row">
                  <span className="avatar teal">ML</span>
                  <div>
                    <strong>Marcus Lee</strong>
                    <p>In progress · Carter</p>
                  </div>
                  <span className="presence busy">Busy</span>
                </div>
                <div className="crew-row">
                  <span className="avatar purple">PS</span>
                  <div>
                    <strong>Priya Shah</strong>
                    <p>Next job · 11:30 AM</p>
                  </div>
                  <span className="presence">Available</span>
                </div>
                <div className="crew-row">
                  <span className="avatar gold">DR</span>
                  <div>
                    <strong>Daniel Ruiz</strong>
                    <p>No jobs assigned</p>
                  </div>
                  <span className="presence">Available</span>
                </div>
              </section>
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function DashboardPage() {
  return <DashboardPreview />;
}
