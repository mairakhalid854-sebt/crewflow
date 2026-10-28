# Phase 7 progress

Phase 7 hardening has started. Staging remains synthetic-only and is not a
production environment.

## Dependency security baseline

- On 2026-10-27, `npm run audit:production` reported zero known production
  vulnerabilities for the web, API, and worker workspaces.
- The compatible `node-forge` 1.4.1 patch removed one Expo CLI advisory without
  changing Expo SDK 57.
- On 2026-10-28 a scoped npm override moved `@expo/cli` to the patched `zod`
  4.6.7, clearing the high-severity GHSA-mrhx-c7xc-m3w5 finding without an
  Expo SDK change. No Expo release (SDK 58 or canary) has left `zod` 3, which
  has no patch. CLI schemas, `expo config`, and an Android export were verified
  under the override.
- One low-severity `deepmerge` advisory (GHSA-gcqx-w48m-w2h4) remains through
  Expo's build-time `@expo/config`. No patched `deepmerge` release exists; its
  reviewed exception expires on 2026-11-10. A production mobile release still
  needs installed-device acceptance and store prerequisites.

## AI staging baseline

- Dispatcher, Intake, Report/Invoice, and Follow-Up guarded provider-review
  functions and migrations are deployed to staging.
- Dispatcher authenticated acceptance passed with `openai/gpt-6-luna` while
  preserving deterministic escalation and no direct mutation.
- Intake, Report/Invoice, and Follow-Up still require authenticated staging
  business-flow acceptance before Phase 6 can be signed off.

## Observability and incident-response foundation

- Next.js server request failures emit one structured JSON event for hosting
  log drains. Events include only a bounded framework route pattern, method,
  route kind, validated correlation ID, error class, and numeric framework
  digest.
- Actual request paths, query strings, headers, cookies, error messages, stack
  traces, customer identifiers, and public-purpose tokens are excluded.
- The incident runbook defines severity, containment, evidence handling,
  credential/tenant-isolation response, recovery verification, and the two
  drills required before launch.
- A read-only GitHub uptime workflow can run the public web health/security
  smoke every 30 minutes without installing application dependencies. It is
  inert until an exact HTTPS monitor URL is configured and supports a dedicated
  Vercel automation bypass secret for protected staging.
- A centralized log destination, named responders, alert routing, provider
  monitors, and completed drill records remain external release gates.

## Backup and restore foundation

- The recovery runbook treats the database and private Storage bytes as
  separate required artifacts, requires encrypted off-provider copies and
  checksums, and forbids restore testing against the source project.
- The isolated drill disables every outbound integration before restoring,
  verifies migrations/RLS/tenant isolation/storage/queues/core journeys, and
  records sanitized RPO/RTO evidence plus target deletion.
- Production plan/retention and approved RPO/RTO decisions, an actual provider
  backup, a private Storage export, and a completed restore drill remain launch
  gates. CI schema resets do not satisfy this requirement.

## Web release smoke foundation

- The Next.js web surface sends HSTS, MIME-sniffing protection, a strict
  referrer policy, a least-privilege browser feature policy, disabled DNS
  prefetch, and disabled legacy cross-domain policy files on every route.
- `/api/health` is a minimal non-cacheable liveness endpoint. It exposes no
  environment values, database details, credentials, or customer data.
- `npm run smoke:web -- https://target.example` checks login, privacy, health,
  required security headers, and the unauthenticated `/app` redirect.
- Protected Vercel previews may be tested by setting
  `VERCEL_AUTOMATION_BYPASS_SECRET` in the operator shell. The secret is sent
  only as the Vercel bypass header and must never be committed or printed.
- The smoke runner rejects non-HTTPS remote targets and has deterministic unit
  coverage for successful, insecure-target, and missing-header paths.

Frame restrictions are intentionally not applied globally because FR-060
requires the public Intake experience to be embeddable. A route-specific frame
policy must be validated with the final customer embedding design before
production.

## Accessibility automation foundation

- Playwright and axe scan login, signup, password recovery, and the privacy
  notice against WCAG 2.0/2.1 A and AA rules in a real Chromium browser.
- A separate keyboard-order test confirms that email, password, submit, and
  password-recovery controls are reachable without a pointer.
- Pull requests and staging/main pushes run the accessibility suite in a clean
  browser through a dedicated CI job.
- `npm run test:a11y` runs the same suite with Playwright Chromium. Automated
  checks are a regression gate, not a replacement for the pending screen-reader
  and representative authenticated-journey acceptance sessions.

## Public web performance baseline

- Playwright measures warm-navigation time to first byte, DOM readiness,
  largest contentful paint, cumulative layout shift, decoded resource bytes,
  and resource count for login and privacy routes in Chromium.
- CI rejects regressions beyond explicit lab budgets: 800 ms TTFB, 2.5 s DOM
  readiness/LCP, 0.1 CLS, 2.5 MB decoded resources, and 60 resources per page.
- `npm run test:performance` runs the same deterministic lab gate locally.
  Production field Core Web Vitals and representative authenticated journeys
  remain release gates because synthetic local measurements cannot replace
  real-user data.

## Transactional email foundation

- Resend is the selected provider for Supabase Auth SMTP and application
  email. `docs/transactional-email.md` covers domain DNS, keys, secrets,
  deployment, the delivery schedule, and acceptance.
- `process-follow-up-email-deliveries` sends only approved transactional
  Follow-Up reminders, revalidating contact and invoice state at claim time,
  with idempotency keys, two-minute leases, and five bounded attempts.
- `resend-email-webhook` verifies Svix signatures and suppresses permanently
  bounced or complaining recipients across tenants.
- Opt-in invitation, quote, and invoice link emails use a token-verified,
  server-rendered queue whose links are joined to a trusted origin at send
  time and scrubbed at every terminal state.
- Delivery is never scheduled by migration. Live sending, job-status and
  work-report emails, and review-request unsubscribe remain open.

## Remaining Phase 7 gates

- Separate production Supabase, Vercel environment, credentials, storage,
  billing webhooks, email credentials, and AI keys.
- Centralized logs, alert destinations, uptime checks, queue-depth alarms, and
  an incident-response drill.
- Measured load and Core Web Vitals, plus manual keyboard, screen-reader, and
  contrast acceptance against representative authenticated journeys.
- Provider backup policy plus a tested off-provider export/restore drill.
- Transactional email domain/provider delivery and suppression acceptance.
- Privacy, terms, consent, tax, cross-border, and marketing review by qualified
  counsel.
- Android/iOS installed-device acceptance, developer-account assets, and store
  review.
- Production smoke execution and explicit `staging` to `main` promotion only
  after all release blockers are closed.
