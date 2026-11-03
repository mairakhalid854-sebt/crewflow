import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610260004_phase6_knowledge_processing_queue.sql',
    import.meta.url,
  ),
  'utf8',
);
const worker = readFileSync(
  new URL(
    '../../../supabase/functions/process-knowledge-documents/index.js',
    import.meta.url,
  ),
  'utf8',
);

describe('phase 6 knowledge processing queue', () => {
  it('uses private durable jobs with bounded attempts and expiring leases', () => {
    expect(migration).toContain(
      'CREATE TABLE public.knowledge_processing_jobs',
    );
    expect(migration).toContain('attempt_count BETWEEN 0 AND 5');
    expect(migration).toContain(
      "lease_expires_at = now() + interval '5 minutes'",
    );
    expect(migration).toContain('FOR UPDATE OF job SKIP LOCKED');
    expect(migration).toContain(
      'REVOKE ALL ON public.knowledge_processing_jobs FROM anon, authenticated',
    );
  });

  it('enqueues both stages only from trusted document state transitions', () => {
    expect(migration).toContain('knowledge_documents_enqueue_processing');
    expect(migration).toContain("WHEN 'scan_pending' THEN 'scan'");
    expect(migration).toContain("WHEN 'parse_pending' THEN 'parse'");
    expect(migration).toContain('UNIQUE (document_id, stage)');
  });

  it('atomically couples stage outcomes to queue completion', () => {
    expect(migration).toContain(
      'CREATE FUNCTION public.finish_knowledge_scan_job',
    );
    expect(migration).toContain('public.record_knowledge_scan_result(');
    expect(migration).toContain(
      'CREATE FUNCTION public.finish_knowledge_parse_job',
    );
    expect(migration).toContain('public.complete_knowledge_document_parse(');
    expect(migration).toContain('public.fail_knowledge_document_parse(');
    expect(migration).toContain('public.complete_knowledge_processing_job(');
  });

  it('fails closed after retry exhaustion and audits the terminal state', () => {
    expect(migration).toContain("status = 'scan_failed'");
    expect(migration).toContain("status = 'parse_failed'");
    expect(migration).toContain("'knowledge.processing_exhausted'");
    expect(migration).toContain("'worker_lease_expired'");
  });

  it('provides a Vault-backed service-only scheduled worker', () => {
    expect(migration).toContain(
      'CREATE FUNCTION public.configure_knowledge_processing_cron()',
    );
    expect(migration).toContain("'/functions/v1/process-knowledge-documents'");
    expect(migration).toContain("'crewflow_edge_function_service_key'");
    expect(migration).toContain('TO service_role;');
  });

  it('keeps scanning fail-closed and parses only after verified content hashes', () => {
    expect(worker).toContain("parsedUrl.protocol !== 'https:'");
    expect(worker).toContain("Deno.env.get('KNOWLEDGE_SCANNER_TOKEN')");
    expect(worker).toContain('sha256 !== job.upload_sha256_claim');
    expect(worker).toContain('sha256 !== job.content_sha256');
    expect(worker).toContain("job.stage === 'scan'");
    expect(worker).toContain('npm:pdfjs-dist@5.4.394');
    expect(worker).toContain("entry.name === 'word/document.xml'");
    expect(worker).not.toMatch(
      /console\.(?:log|info)\([^)]*(?:bytes|job|body)/,
    );
  });
});
