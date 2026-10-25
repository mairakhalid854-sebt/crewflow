import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610250003_phase6_knowledge_documents.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('phase 6 knowledge-document foundation', () => {
  it('accepts only the PRD file types within the provisional 10 MB limit', () => {
    expect(migration).toContain("'application/pdf'");
    expect(migration).toContain(
      "'application/vnd.openxmlformats-officedocument.wordprocessingml.document'",
    );
    expect(migration).toContain("'text/plain'");
    expect(migration).toContain('byte_size BETWEEN 1 AND 10485760');
    expect(migration).toContain('file_size_limit = EXCLUDED.file_size_limit');
  });

  it('keeps uploads private and unavailable until scan and parse succeed', () => {
    expect(migration).toContain("'quarantined'");
    expect(migration).toContain("'scan_pending'");
    expect(migration).toContain("document.status = 'ready'");
    expect(migration).toContain("document.scan_status = 'clean'");
    expect(migration).toContain("document.parse_status = 'succeeded'");
    expect(migration).toContain("'knowledge-documents',\n  false,");
    expect(migration).not.toContain('knowledge_document_objects_read');
  });

  it('separates owner upload commands from service-only scan and parse commands', () => {
    expect(migration).toContain(
      'CREATE FUNCTION public.reserve_knowledge_document',
    );
    expect(migration).toContain("ARRAY['owner']::public.membership_role[]");
    expect(migration).toContain(
      'CREATE FUNCTION public.record_knowledge_scan_result',
    );
    expect(migration).toContain(
      'CREATE FUNCTION public.complete_knowledge_document_parse',
    );
    expect(
      migration.match(/service role required/g)?.length,
    ).toBeGreaterThanOrEqual(4);
    expect(migration).toContain('TO service_role;');
  });

  it('provides tenant-bound versioning and immutable citation evidence', () => {
    expect(migration).toContain('knowledge_documents_logical_version_unique');
    expect(migration).toContain('knowledge_documents_replacement_tenant_fk');
    expect(migration).toContain('knowledge_document_chunks_document_tenant_fk');
    expect(migration).toContain('knowledge_document_chunks_immutable');
    expect(migration).toContain('knowledge_retrieval_events_immutable');
    expect(migration).toContain('citation_label text NOT NULL');
  });

  it('stores retrieval query hashes instead of raw queries', () => {
    expect(migration).toContain('query_sha256 text NOT NULL');
    expect(migration).toContain('selected_chunk_ids uuid[] NOT NULL');
    expect(migration).toContain('extensions.digest(');
    expect(migration).not.toMatch(/query_text|raw_query|prompt_body/);
  });

  it('prevents browser roles from directly writing document records or chunks', () => {
    expect(migration).toContain(
      'REVOKE ALL ON public.knowledge_documents FROM anon, authenticated',
    );
    expect(migration).toContain(
      'REVOKE ALL ON public.knowledge_document_chunks FROM anon, authenticated',
    );
    expect(migration).not.toContain(
      'GRANT SELECT ON public.knowledge_document_chunks TO authenticated',
    );
    expect(migration).toContain(
      'knowledge_documents_require_write_entitlement',
    );
  });
});
