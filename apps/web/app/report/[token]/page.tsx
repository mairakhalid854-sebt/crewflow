import { notFound } from 'next/navigation';

import { publicWorkReportSchema } from '../../../lib/reports/public-report';
import { createClient } from '../../../lib/supabase/server';
import '../../quote/[token]/styles.css';

export const dynamic = 'force-dynamic';

const tokenPattern = /^[0-9a-f]{64}$/;

function displayDate(value: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(
    new Date(value),
  );
}

function ReportSection({
  children,
  title,
}: Readonly<{ children: string | null; title: string }>) {
  if (!children) return null;
  return (
    <section className="public-report-section">
      <h2>{title}</h2>
      <p>{children}</p>
    </section>
  );
}

export default async function PublicWorkReportPage({
  params,
}: Readonly<{ params: Promise<{ token: string }> }>) {
  const { token } = await params;
  if (!tokenPattern.test(token)) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_public_work_report', {
    report_token: token,
  });
  const parsed = publicWorkReportSchema.safeParse(data);
  if (error || !parsed.success) notFound();
  const report = parsed.data;
  const serviceDate = displayDate(report.scheduled_start_at);

  return (
    <main className="public-quote-shell">
      <section className="public-quote-card public-report-card">
        <header className="public-quote-header">
          <div className="public-quote-brand">
            <span>C</span> CrewFlow
          </div>
          <p>Prepared by {report.company_name}</p>
        </header>
        <div className="public-quote-intro">
          <p className="public-quote-kicker">WORK REPORT</p>
          <h1>{report.job_title}</h1>
          <p>Prepared for {report.customer_name}</p>
          {serviceDate ? <p>Service date: {serviceDate}</p> : null}
        </div>

        <div className="public-report-content">
          <ReportSection title="Summary">{report.summary}</ReportSection>
          <ReportSection title="Work performed">
            {report.work_performed}
          </ReportSection>
          <ReportSection title="Parts used">{report.parts_used}</ReportSection>
          <ReportSection title="Recommendations">
            {report.recommendations}
          </ReportSection>
        </div>

        <p className="public-quote-success" role="status">
          Reviewed and approved by {report.company_name} on{' '}
          {displayDate(report.approved_at)}.
        </p>
        <p className="public-quote-security">
          This secure page contains the approved report snapshot. Contact{' '}
          {report.company_name} if any service detail needs clarification.
        </p>
      </section>
    </main>
  );
}
