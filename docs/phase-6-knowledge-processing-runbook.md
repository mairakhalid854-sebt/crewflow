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

## Delivered CrewFlow gateway

`apps/scanner` implements the contract above without third-party runtime
packages. It validates a constant-time bearer credential, accepts only TXT,
DOCX, and PDF, enforces the same 10 MiB ceiling as the upload pipeline,
recomputes the SHA-256 boundary, and speaks ClamAV's bounded `INSTREAM` TCP
protocol. Only exact terminal `OK` and `FOUND` responses become clean or
infected; timeouts, connection errors, oversized responses, malformed replies,
and engine-version failures all fail closed.

Deploy `apps/scanner/Dockerfile` from the repository root beside a private
ClamAV daemon. The application container needs these server-only variables:

- `SCANNER_AUTH_TOKEN`: a cryptographically random value of at least 32
  characters. Store the identical value as the Supabase secret
  `KNOWLEDGE_SCANNER_TOKEN`.
- `CLAMAV_HOST` and `CLAMAV_PORT`: private-network daemon address; default port
  `3310`. Never expose this port publicly.
- `CLAMAV_TIMEOUT_MS`: optional, bounded from 1,000 to 30,000 ms; default
  `15000`.
- `HOST` and `PORT`: HTTP listener; defaults `0.0.0.0:8080`.

Terminate TLS at the hosting platform or private ingress and set
`KNOWLEDGE_SCANNER_URL` to the exact HTTPS `/v1/scan` route. `/health` is a
credential-free liveness check and intentionally reveals only `{"status":"ok"}`;
it does not certify ClamAV readiness. Do not place secrets in Docker build args,
image layers, client-visible variables, logs, or chat.

Before deployment, run:

```powershell
npm.cmd run typecheck --workspace @crewflow/scanner
npm.cmd test --workspace @crewflow/scanner
npm.cmd run build --workspace @crewflow/scanner
```

## Activation

1. Deploy the CrewFlow gateway plus a current ClamAV daemon on the same private
   network. Confirm the gateway is reachable only through authenticated HTTPS
   and ClamAV TCP port 3310 is not public.
2. Deploy `process-knowledge-documents` with JWT verification disabled; it still
   authenticates scheduled calls by constant-time comparison against the
   configured Supabase service secret.
3. Add `KNOWLEDGE_SCANNER_URL` and `KNOWLEDGE_SCANNER_TOKEN` as Supabase Edge
   Function secrets. Never put either value in Git, Vercel, browser variables,
   logs, or chat.
4. As `service_role`, call `configure_knowledge_processing_cron()`. It reuses
   the existing Vault-held project URL and Edge Function service key and safely
   replaces the one-minute cron job by name.
5. Check that new uploads progress through `scan_pending`, `parse_pending`, and
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
