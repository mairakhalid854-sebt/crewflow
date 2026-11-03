# Phase 5 progress: SaaS subscription billing

Updated: 2026-10-24

Phase 5 has started with a provider-safe entitlement foundation. CrewFlow does
not have a live billing provider, live prices, or any client-side authority to
grant access.

## Delivered in this slice

- Every existing and newly created tenant receives a price-free `stub`
  subscription so local and staging business workflows remain testable without
  real money.
- Plans carry provider price IDs, interval, USD amount, seat limit, AI budget,
  and trial configuration as data rather than production code constants.
- Only the `stub` and `paddle_sandbox` providers exist. A live Paddle enum value,
  checkout, API key, and production webhook path are deliberately absent.
- Owners receive a dedicated CrewFlow billing page. Office users and
  technicians cannot load detailed plan or subscription data.
- Subscription access is explicit: `full`, `grace`, or `read_only`. A past-due
  sandbox event enters grace without silently inventing a grace deadline;
  paused or canceled subscriptions preserve data but block business-record
  writes at the database boundary.
- Paddle sandbox notifications are accepted only after HMAC-SHA256 verification
  of the exact raw body and a bounded timestamp check.
- Verified events store an event ID and payload hash, process retries
  idempotently, reject changed replay payloads, and ignore older subscription
  snapshots.
- The webhook stores no raw Paddle payload, customer email, card data, or other
  unnecessary billing PII.
- Provider event processing is service-role-only and maps configured Paddle
  price IDs to tenant plans. A browser redirect can never grant an entitlement.
- Billing entitlement changes create a tenant audit event containing only safe
  provider, event type, status, and access-mode metadata.
- A service-only reconciliation worker can compare linked sandbox subscriptions
  with Paddle's API, rejects stale or mismatched snapshots, and records bounded
  run counts without storing provider payloads or billing PII.
- The Paddle sandbox webhook destination is active for the eight supported
  subscription lifecycle events. Its signing secret and a least-privilege API
  key are stored only as encrypted Supabase Edge Function secrets.
- The hourly reconciliation cron is active at minute 17. Hosted verification
  on October 22 showed five consecutive successful runs against the linked
  sandbox subscription with zero failures.
- Authenticated owners with an existing sandbox subscription can request a
  fresh, temporary Paddle-hosted customer portal link. Stub tenants do not see
  an active portal button, and portal URLs are restricted to Paddle's exact
  sandbox host.
- The linked sandbox subscription has passed activation, renewal-period,
  past-due/grace, recovery/full-access, cancellation/read-only,
  pause/read-only, and resume/full-access webhook simulations. Every corrected
  replay returned HTTP 200 with `processed`, and the final resume replay left
  staging on full access with the renewed period intact.
- A PostgreSQL-backed pgTAP suite now covers Phase 5 provider events,
  idempotent and changed-payload replays, stale ordering, entitlement mapping,
  read-only write enforcement, recovery, data preservation, role boundaries,
  and unknown-tenant failure handling. CI starts an isolated local Supabase
  stack and runs the complete database suite on every pull request.
- Pull request 46 and its post-merge staging run passed the full quality gate,
  production dependency audit, secret scan, Vercel deployment, and complete
  ten-file pgTAP suite on October 24, 2026.

## Hosted sandbox verification

- Paddle sandbox seller account: created and email-verified for CrewFlow
- Webhook destination: active, platform usage, exactly eight supported
  `subscription.*` events
- Unsigned webhook probe: rejected with HTTP 401 and `Invalid webhook
signature`, confirming the signing secret is loaded
- Reconciliation cron: active as job ID 4 with schedule `17 * * * *`; latest
  observed run completed successfully at `2026-10-22 18:17:00+00`
- Five latest reconciliation runs: all `succeeded`, each checked the one linked
  subscription, with zero failures and no error code
- Hosted customer portal: owner session opened successfully for the linked
  CrewFlow Starter subscription and displayed the configured USD 29 monthly
  trial and next-payment summary
- Lifecycle simulations: renewal advanced the stored period to November 5
  through December 5, 2026; `past_due` produced grace access; activation and
  recovery restored full access; cancellation and pause produced
  data-preserving read-only access; and resume restored full access. Every
  corrected webhook returned HTTP 200 with `processed`.
- Hosted database migrations are fully synchronized through
  `202610240001_preserve_unknown_billing_webhook_events.sql`, which preserves
  an auditable `tenant_not_found` result without a dangling tenant reference.
- Sandbox API key rotation deadline: January 19, 2027

## Remaining Phase 5 work

- Owner decision on monthly/annual plans, prices, seats, AI caps, trial, grace,
  proration, cancellation, and downgrade terms
- Paddle seller approval and verified Pakistan payout/identity eligibility
- Owner approval of the final production catalog and checkout wording; the
  sandbox Starter plan and USD 29 monthly trial are configured and tested
- Edge Function HTTP tests for signed and unsigned requests; database-level
  duplicate, changed-payload, out-of-order, lifecycle, and access-mode coverage
  is now present, while hosted signature rejection is already verified
- Explicit production migration enabling a live provider only after all legal,
  commercial, and security gates pass

## Requirement status

- FR-040: Partial — Paddle sandbox webhook boundary exists; live Merchant of
  Record use remains blocked on seller approval and owner authorization.
- FR-041: Partial — plan terms are configuration-driven, but the actual plan
  configuration remains an open business decision.
- FR-042: Partial — signature verification, idempotency, ordering, entitlement
  sync, audit, customer portal, provider reconciliation, hosted webhook
  secrets, the hourly schedule, real sandbox lifecycle verification, and
  PostgreSQL integration coverage are delivered. Automated Edge Function HTTP
  coverage and the explicit live-provider production migration remain.
- FR-043: Delivered in application/database code — every tenant has a price-free
  stub entitlement and core workflows remain testable without real money.
- FR-044: Partial — data-preserving grace/read-only states and database write
  enforcement exist. Exact grace/downgrade policy still requires approval.
