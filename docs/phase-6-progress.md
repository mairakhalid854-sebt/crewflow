# Phase 6 progress: governed AI platform

Updated: 2026-10-25

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
- A public Intake Edge Function now creates cryptographically random sessions,
  verifies token digests in constant time, bounds request/message sizes, and
  exposes no catalog prices or privileged credentials.
- Database triggers serialize and cap conversation/message bursts. Rejected
  validation turns remain in the immutable transcript without advancing state.
- A responsive public chat page resumes within the same browser tab, supports
  explicit human takeover, and clearly states that chat does not confirm a
  booking or price. The tenant widget remains disabled by default.
- Owners now control Intake enablement and can copy the public request link.
  Owner and office users have a tenant-scoped inbox with attention counts,
  collected customer details, immutable transcripts, and audited takeover.
- Widget enable/disable and key-change events are written to the tenant audit
  trail. Generated database types are synchronized with the deployed schema.
- A tenant knowledge-document boundary now accepts only PDF, DOCX, and TXT
  uploads through short-lived owner reservations. Files are private, capped at
  a provisional 10 MB each and remain quarantined after upload.
- Browser users cannot mark files safe. Only the service-role scanner may record
  a bounded scanner identity, verified content hash, and clean/infected/failed
  result; only clean files advance to parsing.
- The safe-parser boundary accepts at most 500 bounded chunks with page or
  character locations and source labels. Chunks are immutable, version-bound,
  tenant-bound, and unavailable directly to browser clients.
- Full-text retrieval returns only ready, clean, successfully parsed versions.
  Every retrieval records an immutable SHA-256 query hash and selected citation
  IDs without retaining the raw query. Archived versions remain retained but
  are excluded from retrieval.
- This slice establishes the security and data contract only. No malware vendor,
  parser worker, owner upload screen, or live AI model is enabled yet, so owners
  cannot put documents into the ready state from the product UI.
- Owners and office staff now have an AI Operations workspace showing pending
  approvals and recent governed runs. Each approval exposes its rationale,
  consequences, exact bounded change set, target-state version, and expiry.
- Approve/reject requires a written reason plus an explicit acknowledgement.
  Recording approval does not bypass the guarded executor's later permission,
  current-state, policy, and idempotency checks.
- Run inspection shows only redacted summaries plus policy/model identifiers,
  token and estimated-cost metadata, duration, correlation ID, and ordered
  immutable trace steps. Raw prompts and unrestricted tool payloads are absent.
- The first Dispatcher policy is deterministic and side-effect free. It filters
  technicians by active status, exact normalized skills, US ZIP service area,
  availability containment, and schedule conflicts, then ranks eligible workers
  by the bounded workload supplied by the authorized caller.
- Dispatcher input fails closed if any technician or assignment belongs to a
  different tenant. Invalid job intervals or ZIP codes and no-candidate outcomes
  escalate instead of guessing. Reassignment of in-progress work is always
  marked as requiring explicit human approval.
- Dispatcher currently returns a proposal, rationale, exact assignment diff, and
  candidate rejection codes only. It cannot write a job assignment yet.
- Owner and office users can now request a Dispatcher evaluation from a
  tenant-scoped UI. The database re-reads the trusted job, customer, service,
  staff, availability, time-off, conflict, and workload records before ranking.
- Every evaluation creates a redacted governed run and trace. A changed
  assignment creates an expiring human approval with the exact before/after
  membership IDs; no job row is changed by the request path.
- Correlation IDs make retried requests idempotent. Missing candidates create
  an audited escalation rather than a fabricated assignment, and disabled or
  exhausted AI budgets fail closed.
- Approved Dispatcher assignments now pass through an idempotent guarded
  executor. It revalidates the acting role, exact job version, subscription
  access, technician status, skills, service ZIP, availability, time off, and
  schedule conflicts immediately before the only job mutation.
- Changed job state or technician eligibility is retained as a stale/policy
  rejection with an immutable trace and audit event. Approval never guarantees
  execution, and rejected execution leaves the assignment unchanged.
- The first Report Agent policy is deterministic and side-effect free. It only
  accepts completed or closed jobs, orders valid technician notes as recorded,
  counts finalized before/after media without interpreting image contents, and
  recognizes only a valid tenant-bound signature record.
- Parts used and technician recommendations remain explicitly unknown because
  the current field workflow has no structured source for those facts. Missing
  notes, oversized evidence, unfinished work, or cross-tenant evidence escalate
  instead of producing a report. Every proposed draft includes an exact diff and
  requires office approval; this policy slice cannot save, publish, invoice, or
  contact a customer.
- Owner and office users can now request an authoritative Report evaluation for
  completed or closed work. The database loads tenant-bound job/service facts,
  chronological technician notes, finalized photo counts, signature presence,
  and the current editable draft before creating a governed run and approval.
- Each Report approval is bound to a SHA-256 evidence-state version and contains
  exact before/after fields. Repeated correlation IDs are idempotent and an
  unchanged evidence state reuses its current approval. The request path cannot
  write a work report or invoice, publish anything, or contact a customer.
- Approved Report drafts now pass through an idempotent guarded executor. It
  revalidates the active office role, full subscription access, completed job,
  current notes/media/signature evidence hash, current editable draft, exact
  prior values, and bounded proposed fields immediately before the only report
  write. Changed evidence or draft state is retained as a guarded rejection.
- Successful execution saves only an editable draft. Publishing, invoice
  creation, customer delivery, and email remain separate human-controlled
  workflows. The AI Operations screen automatically attempts execution after
  approval and exposes a retry control for interrupted requests.

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
- Edge/API parity tests run the same valid, rejected, and adversarial inputs
  through both deterministic policy implementations. Static boundary tests
  cover credential handling, token entropy, response minimization, and limits.
- Knowledge-document policy tests cover allowed types and size, private storage,
  owner-only reservation, service-only scanning/parsing, tenant isolation,
  immutable citations, versioning, hashed retrieval evidence, and exclusion of
  archived versions.
- Dispatcher orchestration tests cover role and tenant authorization,
  authoritative matching data, budget enforcement, deterministic selection,
  immutable run/trace evidence, exact approval diffs, idempotency, escalation,
  auditing, and proof that proposal requests do not mutate jobs.
- Report policy tests cover evidence ordering, unknown facts, finalized media
  counts, invalid signatures, cross-tenant rejection, unfinished and oversized
  evidence escalation, prompt-like note handling, exact diffs, determinism, and
  the mandatory human-approval boundary.
- Report orchestration tests cover tenant/role authorization, authoritative
  evidence loading, media-count-only grounding, exact diffs, evidence-state
  binding, idempotency, governed escalation, auditing, and proof that proposal
  requests do not mutate reports or create invoices.

## Next Phase 6 slices

1. Run the first controlled staging Intake conversation through public chat,
   office inbox, explicit takeover, and audit verification.
2. Connect a malware-scanner and safe-parser worker, then add the owner knowledge
   upload/version/archive screen. Retrieval must stay unavailable until both
   stages complete successfully.
3. Connect approved requests to typed guarded executors that revalidate current
   role, target state, policy, and idempotency before any side effect.
4. Add adversarial evaluation fixtures for price grounding, cross-tenant
   leakage, prompt injection, tool authorization, escalation, and budget limits.
5. Select a live provider/model, retention window, document limits, and cost
   caps only after owner approval; add it through a separate explicit migration
   and server adapter.

## Requirement status

- FR-060: Intake collection and office takeover are partially delivered; quote
  drafting and verified slot offers remain pending.
- FR-061: Deterministic proposal policy, authorized data loading, governed
  persistence, UI invocation, human approval, and guarded execution are
  delivered.
- FR-062: Deterministic, evidence-bounded report drafting policy, authorized
  orchestration, governed persistence, exact office approvals, and guarded
  editable-draft saving are delivered. Invoice drafting remains pending.
- FR-063: Not yet delivered; governance records exist for the Follow-Up Agent.
- FR-064: Foundation delivered for settings/plan budget enforcement and bounded
  usage metadata; live provider cost accounting remains pending.
- FR-065: Foundation delivered for inspectable, expiring, role-controlled,
  single-use approvals. The human decision UI is delivered; guarded action
  execution remains pending.
- FR-066: Database security foundation delivered for quarantine, scan/parse
  states, private storage, bounded citations, versioning, tenant-scoped retrieval,
  and immutable evidence. Scanner/parser workers and owner UI remain pending.
- FR-067: Immutable redacted run/step traces and inspection UI are delivered;
  replay controls and provider execution remain pending.
- FR-068: Initial governance fixtures delivered; agent-specific adversarial
  evaluations remain pending.
