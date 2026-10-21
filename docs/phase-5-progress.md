# Phase 5 progress: SaaS subscription billing

Updated: 2026-10-21

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
- The hourly reconciliation cron is active at minute 17. A credentialed
  one-off run completed successfully with zero linked sandbox subscriptions,
  zero updates, and zero failures.
- Authenticated owners with an existing sandbox subscription can request a
  fresh, temporary Paddle-hosted customer portal link. Stub tenants do not see
  an active portal button, and portal URLs are restricted to Paddle's exact
  sandbox host.

## Hosted sandbox verification

- Paddle sandbox seller account: created and email-verified for CrewFlow
- Webhook destination: active, platform usage, exactly eight supported
  `subscription.*` events
- Unsigned webhook probe: rejected with HTTP 401 and `Invalid webhook
signature`, confirming the signing secret is loaded
- Reconciliation cron: active as job ID 4 with schedule `17 * * * *`
- Manual reconciliation smoke test: `succeeded`, checked `0`, updated `0`,
  failures `0`, error `NULL`
- Sandbox API key rotation deadline: January 19, 2027

## Remaining Phase 5 work

- Owner decision on monthly/annual plans, prices, seats, AI caps, trial, grace,
  proration, cancellation, and downgrade terms
- Paddle seller approval and verified Pakistan payout/identity eligibility
- Sandbox plan/price configuration and owner-approved checkout launch
- Credentialed lifecycle testing with a real sandbox subscription so the
  webhook, reconciliation worker, and customer portal all process linked data
- Database integration tests on a PostgreSQL-enabled runner, including signed,
  unsigned, duplicate, changed-payload, and out-of-order scenarios
- End-to-end sandbox purchase, renewal, failed-payment, recovery, pause, and
  cancellation tests
- Explicit production migration enabling a live provider only after all legal,
  commercial, and security gates pass

## Requirement status

- FR-040: Partial — Paddle sandbox webhook boundary exists; live Merchant of
  Record use remains blocked on seller approval and owner authorization.
- FR-041: Partial — plan terms are configuration-driven, but the actual plan
  configuration remains an open business decision.
- FR-042: Partial — signature verification, idempotency, ordering, entitlement
  sync, audit, customer portal, provider reconciliation, hosted webhook
  secrets, and the hourly reconciliation schedule are delivered. End-to-end
  lifecycle verification with a real sandbox subscription remains.
- FR-043: Delivered in application/database code — every tenant has a price-free
  stub entitlement and core workflows remain testable without real money.
- FR-044: Partial — data-preserving grace/read-only states and database write
  enforcement exist. Exact grace/downgrade policy still requires approval.
