import type { Json } from '@crewflow/database';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireTenantContext } from '../../../../lib/auth/tenant-context';
import { isoToLocalDateTime } from '../../../../lib/date-time';
import { createClient } from '../../../../lib/supabase/server';
import { archiveJobAction } from '../actions';
import { ArchiveJobButton } from '../archive-job-button';
import { InvoicePanel } from '../invoice-panel';
import { JobForm } from '../job-form';
import { jobStatusLabels } from '../job-status';
import { JobStatusForm } from '../job-status-form';
import { QuotePanel } from '../quote-panel';
import { WorkReportPanel } from '../report-panel';

export const dynamic = 'force-dynamic';

function formatActivity(action: string): string {
  const labels: Readonly<Record<string, string>> = {
    'job.archived': 'Job archived',
    'job.created': 'Job created',
    'job.customer_signature_recorded': 'Customer signature recorded',
    'job.photo_uploaded': 'Technician photo uploaded',
    'job.scheduled': 'Assignment or schedule updated',
    'job.status_changed': 'Job status changed',
    'job.updated': 'Job details updated',
    'job.work_note_added': 'Technician work note added',
  };
  return labels[action] ?? action;
}

function signaturePaths(strokes: Json): string[] {
  if (!Array.isArray(strokes)) return [];

  return strokes.flatMap((stroke) => {
    if (!Array.isArray(stroke)) return [];
    const points = stroke.flatMap((point) => {
      if (!point || Array.isArray(point) || typeof point !== 'object')
        return [];
      const x = point.x;
      const y = point.y;
      if (typeof x !== 'number' || typeof y !== 'number') return [];
      if (x < 0 || x > 1 || y < 0 || y > 1) return [];
      return [{ x, y }];
    });
    if (points.length < 2) return [];

    return [
      points
        .map(
          (point, index) =>
            `${index === 0 ? 'M' : 'L'} ${point.x * 1000} ${point.y * 300}`,
        )
        .join(' '),
    ];
  });
}

export default async function JobDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const context = await requireTenantContext();
  const supabase = await createClient();
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', context.tenantId)
    .is('archived_at', null)
    .maybeSingle();
  if (jobError) throw new Error('Job could not be loaded.');
  if (!job) notFound();

  const [
    customersResult,
    servicesResult,
    membersResult,
    profilesResult,
    activityResult,
    jobMediaResult,
    jobSignatureResult,
    workNotesResult,
    quoteResult,
    invoiceResult,
    reportResult,
  ] = await Promise.all([
    supabase
      .from('customers')
      .select('id, first_name, last_name')
      .eq('tenant_id', context.tenantId)
      .order('last_name'),
    supabase
      .from('services')
      .select('id, name')
      .eq('tenant_id', context.tenantId)
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
    supabase
      .from('audit_events')
      .select('id, action, metadata, occurred_at')
      .eq('tenant_id', context.tenantId)
      .eq('entity_type', 'job')
      .eq('entity_id', id)
      .order('occurred_at', { ascending: false })
      .limit(50),
    supabase
      .from('job_media')
      .select('id, media_kind, captured_at')
      .eq('tenant_id', context.tenantId)
      .eq('job_id', id)
      .not('uploaded_at', 'is', null)
      .order('captured_at', { ascending: false })
      .limit(20),
    supabase
      .from('job_signatures')
      .select(
        'id, consent_text, integrity_hash, signature_strokes, signed_at, signer_name',
      )
      .eq('tenant_id', context.tenantId)
      .eq('job_id', id)
      .maybeSingle(),
    supabase
      .from('job_work_notes')
      .select('id, body, created_at')
      .eq('tenant_id', context.tenantId)
      .eq('job_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('quotes')
      .select('*')
      .eq('tenant_id', context.tenantId)
      .eq('job_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    context.role === 'technician'
      ? Promise.resolve({ data: null, error: null })
      : supabase
          .from('invoices')
          .select('*')
          .eq('tenant_id', context.tenantId)
          .eq('job_id', id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
    context.role === 'technician'
      ? Promise.resolve({ data: null, error: null })
      : supabase
          .from('work_reports')
          .select('*')
          .eq('tenant_id', context.tenantId)
          .eq('job_id', id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
  ]);

  if (
    customersResult.error ||
    servicesResult.error ||
    membersResult.error ||
    profilesResult.error ||
    activityResult.error ||
    jobMediaResult.error ||
    jobSignatureResult.error ||
    workNotesResult.error ||
    quoteResult.error ||
    invoiceResult.error ||
    reportResult.error
  ) {
    throw new Error('Job details could not be loaded.');
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
    .filter(
      (profile) =>
        activeTechnicians.has(profile.membership_id) ||
        profile.membership_id === job.assigned_membership_id,
    )
    .map((profile) => ({
      id: profile.membership_id,
      label: profile.full_name,
    }));
  const customerName =
    customers.find((customer) => customer.id === job.customer_id)?.label ??
    'Customer';
  const technicianName = job.assigned_membership_id
    ? (technicians.find(
        (technician) => technician.id === job.assigned_membership_id,
      )?.label ?? 'Technician')
    : 'Unassigned';
  const latestQuote = quoteResult.data ?? undefined;
  const { data: quoteLines, error: quoteLinesError } = latestQuote
    ? await supabase
        .from('quote_line_items')
        .select('*')
        .eq('tenant_id', context.tenantId)
        .eq('quote_id', latestQuote.id)
        .order('position')
    : { data: [], error: null };
  if (quoteLinesError) throw new Error('Quote details could not be loaded.');
  const latestInvoice = invoiceResult.data ?? undefined;
  const [invoiceLinesResult, paymentsResult] = latestInvoice
    ? await Promise.all([
        supabase
          .from('invoice_line_items')
          .select('*')
          .eq('tenant_id', context.tenantId)
          .eq('invoice_id', latestInvoice.id)
          .order('position'),
        supabase
          .from('payment_records')
          .select('*')
          .eq('tenant_id', context.tenantId)
          .eq('invoice_id', latestInvoice.id)
          .order('received_at', { ascending: false }),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];
  if (invoiceLinesResult.error || paymentsResult.error) {
    throw new Error('Invoice details could not be loaded.');
  }

  return (
    <div className="workspace-page job-detail-page">
      <Link className="back-link" href="/app/jobs">
        ← Back to jobs
      </Link>
      <header className="job-detail-header">
        <div>
          <p className="workspace-kicker">{customerName}</p>
          <h1>{job.title}</h1>
          <div className="job-summary-badges">
            <span className={`status-badge status-job-${job.status}`}>
              {jobStatusLabels[job.status]}
            </span>
            <span className="status-badge">{job.priority} priority</span>
            <span className="status-badge">{technicianName}</span>
          </div>
        </div>
      </header>

      {context.role === 'technician' ? (
        <section className="job-readonly-card">
          <h2>Assigned work</h2>
          <dl>
            <div>
              <dt>Customer</dt>
              <dd>{customerName}</dd>
            </div>
            <div>
              <dt>Technician</dt>
              <dd>{technicianName}</dd>
            </div>
            <div>
              <dt>Schedule</dt>
              <dd>
                {job.scheduled_start_at
                  ? new Intl.DateTimeFormat('en-US', {
                      dateStyle: 'full',
                      timeStyle: 'short',
                      timeZone: context.timeZone,
                    }).format(new Date(job.scheduled_start_at))
                  : 'Not scheduled'}
              </dd>
            </div>
            <div>
              <dt>Description</dt>
              <dd>{job.description ?? 'No description'}</dd>
            </div>
          </dl>
        </section>
      ) : (
        <div className="job-detail-grid">
          <div>
            <JobForm
              customers={customers}
              job={job}
              scheduledEndLocal={isoToLocalDateTime(
                job.scheduled_end_at,
                context.timeZone,
              )}
              scheduledStartLocal={isoToLocalDateTime(
                job.scheduled_start_at,
                context.timeZone,
              )}
              services={services}
              technicians={technicians}
              timeZone={context.timeZone}
            />
          </div>
          <aside className="job-workflow-panel">
            <h2>Workflow</h2>
            <p>
              Status changes follow the guarded job lifecycle and are recorded
              in the activity timeline.
            </p>
            <JobStatusForm jobId={job.id} status={job.status} />
            <ArchiveJobButton action={archiveJobAction} jobId={job.id} />
          </aside>
        </div>
      )}

      {context.role !== 'technician' ? (
        <>
          <QuotePanel
            jobId={job.id}
            lines={quoteLines ?? []}
            quote={latestQuote}
          />
          <WorkReportPanel
            jobId={job.id}
            jobStatus={job.status}
            report={reportResult.data ?? undefined}
          />
          <InvoicePanel
            invoice={latestInvoice}
            jobId={job.id}
            jobStatus={job.status}
            lines={invoiceLinesResult.data ?? []}
            payments={paymentsResult.data ?? []}
            receivedAtLocal={isoToLocalDateTime(
              new Date().toISOString(),
              context.timeZone,
            )}
            role={context.role}
            timeZone={context.timeZone}
          />
        </>
      ) : null}

      <section className="team-panel job-activity-panel">
        <div className="team-panel-heading">
          <div>
            <h2>Private job photos</h2>
            <p>
              Authorized before and after photos captured by the technician.
            </p>
          </div>
        </div>
        {(jobMediaResult.data ?? []).length ? (
          <div className="job-photo-grid">
            {(jobMediaResult.data ?? []).map((photo) => (
              <figure key={photo.id}>
                <Image
                  alt={`${photo.media_kind} job photo`}
                  height={240}
                  src={`/app/jobs/${job.id}/media/${photo.id}`}
                  unoptimized
                  width={320}
                />
                <figcaption>
                  <strong>{photo.media_kind} photo</strong>
                  <time dateTime={photo.captured_at}>
                    {new Intl.DateTimeFormat('en-US', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: context.timeZone,
                    }).format(new Date(photo.captured_at))}
                  </time>
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <p className="form-help">No technician photos uploaded yet.</p>
        )}
      </section>

      <section className="team-panel job-activity-panel">
        <div className="team-panel-heading">
          <div>
            <h2>Customer signature</h2>
            <p>
              Immutable customer consent and signature evidence captured in the
              field.
            </p>
          </div>
        </div>
        {jobSignatureResult.data ? (
          <div className="job-signature-card">
            <svg
              aria-label={`Signature by ${jobSignatureResult.data.signer_name}`}
              role="img"
              viewBox="0 0 1000 300"
            >
              {signaturePaths(jobSignatureResult.data.signature_strokes).map(
                (path, index) => (
                  <path d={path} key={index} />
                ),
              )}
            </svg>
            <dl>
              <div>
                <dt>Signed by</dt>
                <dd>{jobSignatureResult.data.signer_name}</dd>
              </div>
              <div>
                <dt>Server timestamp</dt>
                <dd>
                  <time dateTime={jobSignatureResult.data.signed_at}>
                    {new Intl.DateTimeFormat('en-US', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: context.timeZone,
                    }).format(new Date(jobSignatureResult.data.signed_at))}
                  </time>
                </dd>
              </div>
              <div>
                <dt>Consent</dt>
                <dd>{jobSignatureResult.data.consent_text}</dd>
              </div>
              <div>
                <dt>Integrity SHA-256</dt>
                <dd>
                  <code>{jobSignatureResult.data.integrity_hash}</code>
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <p className="form-help">No customer signature recorded yet.</p>
        )}
      </section>

      <section className="team-panel job-activity-panel">
        <div className="team-panel-heading">
          <div>
            <h2>Technician field notes</h2>
            <p>
              Immutable updates recorded while the assigned work progresses.
            </p>
          </div>
        </div>
        {(workNotesResult.data ?? []).length ? (
          <ol className="work-note-list">
            {(workNotesResult.data ?? []).map((note) => (
              <li key={note.id}>
                <p>{note.body}</p>
                <time dateTime={note.created_at}>
                  {new Intl.DateTimeFormat('en-US', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: context.timeZone,
                  }).format(new Date(note.created_at))}
                </time>
              </li>
            ))}
          </ol>
        ) : (
          <p className="form-help">No technician field notes yet.</p>
        )}
      </section>

      <section className="team-panel job-activity-panel">
        <div className="team-panel-heading">
          <div>
            <h2>Activity</h2>
            <p>Immutable job changes, newest first.</p>
          </div>
        </div>
        {(activityResult.data ?? []).length ? (
          <ol className="activity-list">
            {(activityResult.data ?? []).map((event) => (
              <li key={event.id}>
                <strong>{formatActivity(event.action)}</strong>
                <time dateTime={event.occurred_at}>
                  {new Intl.DateTimeFormat('en-US', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: context.timeZone,
                  }).format(new Date(event.occurred_at))}
                </time>
              </li>
            ))}
          </ol>
        ) : (
          <p className="form-help">No activity recorded yet.</p>
        )}
      </section>
    </div>
  );
}
