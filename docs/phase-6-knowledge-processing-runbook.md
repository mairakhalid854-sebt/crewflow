# Phase 6 knowledge processing runbook

The CrewFlow worker never treats a browser upload as safe. Every document stays
private and unavailable to retrieval until a trusted malware scan returns
`clean` and the parser commits bounded citation chunks.

## Required scanner contract

Provide a private HTTPS endpoint in `KNOWLEDGE_SCANNER_URL` and its bearer token
in `KNOWLEDGE_SCANNER_TOKEN`. CrewFlow sends the original bytes with:

- `Authorization: Bearer <token>`
- the reserved MIME type in `Content-Type`
- the locally recomputed SHA-256 in `X-Content-Sha256`

The scanner must return HTTP 200 and one bounded JSON result:

```json
{
  "verdict": "clean",
  "scannerName": "ClamAV gateway",
  "scannerVersion": "1.4.3"
}
```

`verdict` may be only `clean` or `infected`. The endpoint must not echo document
content, file names, paths, credentials, or unbounded vendor error details.
Use a private ClamAV gateway or a commercial scanner whose privacy terms permit
customer business documents. Do not use a public malware-sharing service.

## Activation

1. Deploy `process-knowledge-documents` with JWT verification disabled; it still
   authenticates scheduled calls by constant-time comparison against the
   configured Supabase service secret.
2. Add `KNOWLEDGE_SCANNER_URL` and `KNOWLEDGE_SCANNER_TOKEN` as Supabase Edge
   Function secrets. Never put either value in Git, Vercel, browser variables,
   logs, or chat.
3. As `service_role`, call `configure_knowledge_processing_cron()`. It reuses
   the existing Vault-held project URL and Edge Function service key and safely
   replaces the one-minute cron job by name.
4. Check that new uploads progress through `scan_pending`, `parse_pending`, and
   `ready`. A failed or infected document must end in `scan_failed`; malformed,
   encrypted, empty, or unsupported content must end in `parse_failed`.

Do not enable the cron before both scanner secrets exist. If the scanner is
temporarily unavailable, jobs retry with bounded backoff. After five attempts,
the document fails closed and an audit event records only the stage and bounded
error code.

## Acceptance matrix

- Clean UTF-8 TXT becomes ready and returns a citation with character offsets.
- Clean DOCX becomes ready without importing macros, relationships, images, or
  embedded objects; only `word/document.xml` text is extracted.
- Clean PDF becomes ready with page-number citations.
- EICAR or another scanner test fixture is marked infected and never parsed.
- Changed object bytes fail the SHA-256 boundary and never become searchable.
- Encrypted/invalid PDF, invalid DOCX, binary TXT, blank content, and extraction
  limits fail closed.
- A forced scanner outage retries and then terminally fails after attempt five.
- Tenant B cannot read Tenant A document metadata, chunks, jobs, or retrieval
  evidence.

The staging acceptance fixtures must contain no real customer information.
