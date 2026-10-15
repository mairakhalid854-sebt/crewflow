import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireTenantContext } from '../../../../../lib/auth/tenant-context';
import { createClient } from '../../../../../lib/supabase/server';
import { WorkReportForm } from '../../report-form';

export const dynamic = 'force-dynamic';

export default async function JobWorkReportPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const context = await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('id, status, title')
    .eq('id', id)
    .eq('tenant_id', context.tenantId)
    .is('archived_at', null)
    .maybeSingle();
  if (jobError) throw new Error('Job could not be loaded.');
  if (!job || !['completed', 'closed'].includes(job.status)) notFound();

  const { data: draft, error: draftError } = await supabase
    .from('work_reports')
    .select('*')
    .eq('tenant_id', context.tenantId)
    .eq('job_id', job.id)
    .eq('status', 'draft')
    .maybeSingle();
  if (draftError) throw new Error('Work report could not be loaded.');

  return (
    <div className="workspace-page resource-editor-page">
      <Link className="back-link" href={`/app/jobs/${job.id}`}>
        Back to job
      </Link>
      <header className="resource-editor-header">
        <p className="workspace-kicker">WORK REPORT DRAFT</p>
        <h1>{job.title}</h1>
        <p>
          Write only verified service facts. An owner or office user must review
          this draft before a customer link is created.
        </p>
      </header>
      <WorkReportForm
        initialPartsUsed={draft?.parts_used ?? ''}
        initialRecommendations={draft?.recommendations ?? ''}
        initialSummary={draft?.summary ?? ''}
        initialWorkPerformed={draft?.work_performed ?? ''}
        jobId={job.id}
      />
    </div>
  );
}
