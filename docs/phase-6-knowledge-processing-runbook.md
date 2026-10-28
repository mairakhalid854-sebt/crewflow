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
credential-free process liveness check. `/ready` verifies a bounded ClamAV
version response and returns only ready or a generic 503; the image healthcheck
uses this stronger endpoint. Neither route returns daemon addresses, versions,
credentials, or document data. Do not place secrets in Docker build args, image
layers, client-visible variables, logs, or chat.

Before deployment, run:

```powershell
npm.cmd run typecheck --workspace @crewflow/scanner
npm.cmd test --workspace @crewflow/scanner
npm.cmd run build --workspace @crewflow/scanner
```

## Hosting options

Two supported targets run the same image and ClamAV engine. Choose one per
environment:

- **Single VPS** (lowest cost, about one fixed small-server fee per month): the
  operator owns OS patching, firewall, Docker updates, and monitoring.
- **Railway** (managed, usage-billed): ClamAV's resident signature memory
  dominates the bill, so expect a multiple of the VPS cost.

## VPS hosting

Use a VPS with at least 2 vCPU and 4 GB RAM (add 2 GB swap) running a
supported Ubuntu LTS with Docker Engine and the Compose plugin.

1. Allow only SSH, 80, and 443 inbound in the provider firewall and `ufw`.
   Enable unattended security upgrades and key-only SSH login.
2. Point a hostname at the server. Without an owned domain, the
   `<ip-with-dashes>.sslip.io` form (for example `203-0-113-10.sslip.io`)
   resolves to that IP and receives a normal Let's Encrypt certificate.
3. Clone the repository, then in `apps/scanner/vps` copy `.env.example` to
   `.env`, set `SCANNER_DOMAIN`, and set `SCANNER_AUTH_TOKEN` to a value
   generated on the server (see the Railway steps for a generator). Restrict it
   with `chmod 600 .env`.
4. Run `docker compose up -d --build`. The first freshclam download can take
   several minutes; `docker compose logs -f clamav` shows progress.
5. Verify as in Railway step 5, and confirm from another machine that ports
   3310 and 8080 are closed.
6. Update with `git pull && docker compose up -d --build`, and run
   `docker compose pull` monthly for patched Caddy/ClamAV images after bumping
   pinned tags.

## Railway hosting

One Railway project environment holds two services built from this
repository; both use config-as-code, so set each service's **Config file
path** in its settings.

| Service   | Config file path                    | Network exposure                             |
| --------- | ----------------------------------- | -------------------------------------------- |
| `scanner` | `/apps/scanner/railway.json`        | Railway-generated HTTPS domain only          |
| `clamav`  | `/apps/scanner/clamav/railway.json` | Private network only; no domain or TCP proxy |

1. Create the `clamav` service from the repository, set its config path, and
   attach a volume mounted at `/var/lib/clamav` so signatures survive restarts
   and freshclam does not re-download the full database. Give it at least
   4 GB memory; clamd briefly holds two signature sets during reloads. Never
   generate a domain or TCP proxy for it.
2. Wait for the first deploy logs to show freshclam completing and clamd
   listening on 3310. The first signature download can take several minutes.
3. Create the `scanner` service from the repository and set its config path.
   Add variables, marking the token as sealed:
   - `SCANNER_AUTH_TOKEN`: a new random value of at least 32 characters,
     generated locally (for example
     `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`)
     and pasted only into Railway and Supabase Secrets.
   - `CLAMAV_HOST`: `${{clamav.RAILWAY_PRIVATE_DOMAIN}}`
   - `CLAMAV_PORT`: `3310`
     Railway injects `PORT`; do not override it.
4. Generate a Railway public domain for `scanner` only. Deploys are gated on
   `/ready`, so a successful deploy proves the gateway reached clamd over the
   private network. If `/ready` fails while clamd is healthy, check that the
   private-network address family resolved by `CLAMAV_HOST` is one clamd binds.
5. From the operator shell, confirm `GET https://<domain>/health` and
   `/ready` return 200, and that `POST /v1/scan` without a bearer token is
   rejected. Confirm no public endpoint exists for `clamav`.
6. Continue with Activation below using
   `KNOWLEDGE_SCANNER_URL=https://<domain>/v1/scan`.

Operations:

- Watch `clamav` logs for freshclam failures; stale signatures are a security
  incident under `docs/incident-response.md`, not a cosmetic warning.
- Bump the pinned `clamav/clamav` engine tag deliberately after reviewing the
  release notes; signature updates do not require an image change.
- Rotate `SCANNER_AUTH_TOKEN` by updating Railway and the Supabase secret
  `KNOWLEDGE_SCANNER_TOKEN` together; in-flight jobs retry with backoff.

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
