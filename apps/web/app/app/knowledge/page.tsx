import type { Database } from '@crewflow/database';

import { requireTenantContext } from '../../../lib/auth/tenant-context';
import { createClient } from '../../../lib/supabase/server';

import {
  ArchiveKnowledgeButton,
  KnowledgeUploadForm,
} from './knowledge-controls';
import styles from './knowledge.module.css';

export const dynamic = 'force-dynamic';

type KnowledgeDocument = Pick<
  Database['public']['Tables']['knowledge_documents']['Row'],
  | 'archived_at'
  | 'byte_size'
  | 'created_at'
  | 'id'
  | 'logical_document_id'
  | 'original_file_name'
  | 'parse_failure_code'
  | 'parse_status'
  | 'parsed_at'
  | 'scan_failure_code'
  | 'scan_status'
  | 'scanned_at'
  | 'status'
  | 'title'
  | 'updated_at'
  | 'uploaded_at'
  | 'version'
>;

function formatDate(value: string | null): string {
  if (!value) return 'Not yet';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function label(value: string): string {
  return value.replaceAll('_', ' ');
}

export default async function KnowledgeBasePage() {
  const context = await requireTenantContext(['owner', 'office']);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('knowledge_documents')
    .select(
      'id,logical_document_id,version,title,original_file_name,byte_size,status,scan_status,parse_status,scan_failure_code,parse_failure_code,created_at,updated_at,uploaded_at,scanned_at,parsed_at,archived_at',
    )
    .eq('tenant_id', context.tenantId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw new Error('Knowledge documents could not be loaded.');
  const documents = (data ?? []) as KnowledgeDocument[];
  const activeDocuments = documents.filter(
    (document) => document.status !== 'archived',
  );
  const latestByLogicalId = new Map<string, KnowledgeDocument>();
  for (const document of documents) {
    const current = latestByLogicalId.get(document.logical_document_id);
    if (!current || document.version > current.version) {
      latestByLogicalId.set(document.logical_document_id, document);
    }
  }
  const readyCount = activeDocuments.filter(
    (document) => document.status === 'ready',
  ).length;
  const attentionCount = activeDocuments.filter((document) =>
    ['scan_failed', 'parse_failed'].includes(document.status),
  ).length;

  return (
    <div className="workspace-page">
      <header className="workspace-heading">
        <div>
          <p className="workspace-kicker">Tenant-scoped AI sources</p>
          <h1>Knowledge base</h1>
          <p>
            Manage private policies, FAQs, and price-list source documents with
            version history and a fail-closed scan pipeline.
          </p>
        </div>
      </header>

      <section className={styles.summary} aria-label="Knowledge summary">
        <div>
          <span>Active versions</span>
          <strong>{activeDocuments.length}</strong>
        </div>
        <div>
          <span>Ready for retrieval</span>
          <strong>{readyCount}</strong>
        </div>
        <div>
          <span>Needs attention</span>
          <strong>{attentionCount}</strong>
        </div>
      </section>

      {context.role === 'owner' ? (
        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <p>Private upload</p>
              <h2>Add a source document</h2>
            </div>
            <span>Owner only</span>
          </div>
          <KnowledgeUploadForm
            versionTargets={[...latestByLogicalId.values()]
              .filter((document) => document.status !== 'archived')
              .map((document) => ({
                id: document.id,
                label: `${document.title} (current v${document.version})`,
              }))}
          />
        </section>
      ) : (
        <section className={styles.notice}>
          Office staff can review document state. Only an owner may upload,
          version, or archive a knowledge source.
        </section>
      )}

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div>
            <p>Version history</p>
            <h2>Documents</h2>
          </div>
          <span>{documents.length} retained</span>
        </div>

        {documents.length ? (
          <div className={styles.documentList}>
            {documents.map((document) => (
              <article className={styles.documentCard} key={document.id}>
                <div className={styles.documentHeader}>
                  <div>
                    <span
                      className={styles.status}
                      data-status={document.status}
                    >
                      {label(document.status)}
                    </span>
                    <h3>{document.title}</h3>
                    <p>
                      {document.original_file_name} ·{' '}
                      {formatBytes(document.byte_size)}
                    </p>
                  </div>
                  <strong>v{document.version}</strong>
                </div>

                <dl className={styles.facts}>
                  <div>
                    <dt>Uploaded</dt>
                    <dd>{formatDate(document.uploaded_at)}</dd>
                  </div>
                  <div>
                    <dt>Malware scan</dt>
                    <dd>{label(document.scan_status)}</dd>
                  </div>
                  <div>
                    <dt>Scanned</dt>
                    <dd>{formatDate(document.scanned_at)}</dd>
                  </div>
                  <div>
                    <dt>Parsed</dt>
                    <dd>
                      {label(document.parse_status)} ·{' '}
                      {formatDate(document.parsed_at)}
                    </dd>
                  </div>
                </dl>

                {document.scan_failure_code || document.parse_failure_code ? (
                  <p className={styles.failure}>
                    Pipeline stopped safely:{' '}
                    {document.scan_failure_code ?? document.parse_failure_code}
                  </p>
                ) : null}
                {context.role === 'owner' && document.status !== 'archived' ? (
                  <ArchiveKnowledgeButton documentId={document.id} />
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <h3>No knowledge documents yet</h3>
            <p>
              Upload the first PDF, DOCX, or TXT source. It will remain private
              and unavailable to AI while safety processing is pending.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
