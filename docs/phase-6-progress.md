# Phase 6 progress: governed AI platform

Updated: 2026-10-24

Phase 6 has started with a provider-neutral governance boundary. No paid AI
provider, model API key, autonomous customer action, or production AI feature is
enabled by this slice.

## Delivered in this slice

- Tenant-scoped run records cover Intake, Dispatcher, Report, and Follow-Up
  agent kinds without enabling any of those agents yet.
- The only allowed provider/model pair is the deterministic development stub;
  live provider names and credentials are absent.
- New AI work is blocked unless an owner has enabled AI operations and a
  positive monthly budget remains.
- The effective monthly budget respects both the tenant setting and the active
  subscription plan cap when the plan supplies one.
- Run creation is service-role-only and requires an active owner or office actor
  in the same tenant.
- Correlation IDs make identical starts idempotent and reject changed payloads
  under an existing correlation ID.
- Run and step records retain bounded redacted summaries, model/token/cost
  metadata, duration, status, and policy version without storing raw prompts or
  tool payloads.
- Trace steps are immutable and tenant-bound through composite foreign keys.
- Approval requests show rationale, exact proposed changes, consequences,
  target identity/state metadata, and expire within 48 hours.
- Only active owners or office staff can inspect and decide approvals. Decisions
  lock the row, are single-use, convert late attempts to expired, and write an
  immutable audit event.
- Browser roles have no direct insert/update/delete access to AI governance
  tables; orchestration writes stay behind the privileged server boundary.
- The Intake Agent now has a deterministic one-question-at-a-time policy with
  validated name, contact, address, problem, and catalog confirmation stages.
- Persistent intake sessions are tenant-bound, expire within 24 hours, store
  only a SHA-256 session-token digest, and freeze a bounded enabled-service
  catalog snapshot so later catalog edits cannot change an active conversation.
- Intake transcripts are immutable, unavailable directly to anonymous clients,
  and limited to 1,000 bounded messages. Owner/office human takeover stops
  automation and writes a tenant audit event.

## Validation

- Static migration policy tests cover provider restrictions, redaction,
  immutability, role boundaries, budgets, approval expiry, and audit behavior.
- A pgTAP integration suite covers disabled and exhausted budgets, idempotent
  starts, changed-correlation rejection, technician isolation, immutable traces,
  approval lifetime, single-use decisions, and expiry.
- Intake policy unit tests cover validation, US phone normalization, catalog
  grounding, ambiguity, prompt injection, cross-tenant requests, and escalation.
- Intake persistence tests cover hashed tokens, catalog snapshots, wrong-token
  denial, immutable messages, role-scoped takeover, and takeover auditing.

## Next Phase 6 slices

1. Connect the Intake policy and persistence boundary to a rate-limited public
   API endpoint and embeddable web chat, then add the owner inbox/takeover UI.
2. Add tenant knowledge-document quarantine, parsing, versioning, citations,
   size/type limits, and malware-scan status before retrieval is enabled.
3. Add the web AI-runs and approval-queue screens.
4. Add adversarial evaluation fixtures for price grounding, cross-tenant
   leakage, prompt injection, tool authorization, escalation, and budget limits.
5. Select a live provider/model, retention window, document limits, and cost
   caps only after owner approval; add it through a separate explicit migration
   and server adapter.

## Requirement status

- FR-060–063: Not yet delivered; governance records exist for all four agent
  kinds, with Intake scheduled first.
- FR-064: Foundation delivered for settings/plan budget enforcement and bounded
  usage metadata; live provider cost accounting remains pending.
- FR-065: Foundation delivered for inspectable, expiring, role-controlled,
  single-use approvals. Action execution and UI remain pending.
- FR-066: Pending.
- FR-067: Foundation delivered for immutable redacted run/step traces; replay UI
  and provider execution remain pending.
- FR-068: Initial governance fixtures delivered; agent-specific adversarial
  evaluations remain pending.
