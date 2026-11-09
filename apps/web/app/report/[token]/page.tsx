import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { LanguageSwitch } from '../../../components/language-switch';
import {
  dateLocale,
  type PublicLocale,
  publicCopy,
  resolvePublicLocale,
} from '../../../lib/i18n/public-copy';
import { publicWorkReportSchema } from '../../../lib/reports/public-report';
import { createClient } from '../../../lib/supabase/server';
import '../../quote/[token]/styles.css';

export const dynamic = 'force-dynamic';

const tokenPattern = /^[0-9a-f]{64}$/;

function displayDate(
  value: string | null,
  locale: PublicLocale,
): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat(dateLocale(locale), {
    dateStyle: 'long',
  }).format(new Date(value));
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
  searchParams,
}: Readonly<{
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string }>;
}>) {
  const { token } = await params;
  if (!tokenPattern.test(token)) notFound();
  const locale = resolvePublicLocale(
    (await searchParams).lang,
    (await headers()).get('accept-language'),
  );
  const t = publicCopy(locale);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_public_work_report', {
    report_token: token,
  });
  const parsed = publicWorkReportSchema.safeParse(data);
  if (error || !parsed.success) notFound();
  const report = parsed.data;
  const serviceDate = displayDate(report.scheduled_start_at, locale);

  return (
    <main className="public-quote-shell" lang={locale}>
      <section className="public-quote-card public-report-card">
        <header className="public-quote-header">
          <div className="public-quote-brand">
            <span>C</span> CrewFlow360
          </div>
          <p>{t.common.preparedBy(report.company_name)}</p>
        </header>
        <LanguageSwitch
          label={t.common.languageLabel}
          locale={locale}
          path={`/report/${token}`}
        />
        <div className="public-quote-intro">
          <p className="public-quote-kicker">{t.report.kicker}</p>
          <h1>{report.job_title}</h1>
          <p>{t.report.preparedFor(report.customer_name)}</p>
          {serviceDate ? <p>{t.report.serviceDate(serviceDate)}</p> : null}
        </div>

        <div className="public-report-content">
          <ReportSection title={t.report.summary}>
            {report.summary}
          </ReportSection>
          <ReportSection title={t.report.workPerformed}>
            {report.work_performed}
          </ReportSection>
          <ReportSection title={t.report.partsUsed}>
            {report.parts_used}
          </ReportSection>
          <ReportSection title={t.report.recommendations}>
            {report.recommendations}
          </ReportSection>
        </div>

        <p className="public-quote-success" role="status">
          {t.report.approved(
            report.company_name,
            displayDate(report.approved_at, locale),
          )}
        </p>
        <p className="public-quote-security">
          {t.report.security(report.company_name)}
        </p>
      </section>
    </main>
  );
}
