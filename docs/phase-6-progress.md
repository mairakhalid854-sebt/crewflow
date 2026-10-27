# Phase 6 progress: governed AI platform

Updated: 2026-10-27

Phase 6 began with a provider-neutral governance boundary. The evaluated OpenAI
candidate is now connected to bounded review paths for all four agent kinds;
autonomous customer actions and production AI remain disabled.

## Delivered in this slice

- Tenant-scoped run records cover Intake, Dispatcher, Report, and Follow-Up
  agent kinds without enabling any of those agents yet.
- Provider/model identity is constrained to the deterministic development stub
  or the evaluated OpenAI model. All four agent review paths can record the
  latter only through service-role-only bounded recorders.
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
- Knowledge uploads now enter a private durable two-stage queue. Service-only
  claims use expiring leases, bounded exponential retry, a five-attempt cap,
  atomic document/job completion, and immutable terminal-failure auditing.
- A scheduled Edge worker verifies object size and SHA-256 before and after
  scanning, accepts only bounded clean/infected responses from an HTTPS malware
  scanner, and parses UTF-8 TXT, DOCX main-document XML, and PDF page text into
  deterministic bounded citation chunks. Empty, encrypted, malformed,
  oversized, hash-changed, and retry-exhausted documents fail closed.
- The worker and parser are delivered, but staging activation remains disabled
  until a private malware-scanner endpoint and bearer credential are supplied.
  Retrieval therefore remains unavailable for new uploads in the current
  environment; no browser or cron path can bypass the clean-scan boundary.
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
- The first governed invoice-drafting policy prefers the latest accepted quote
  snapshot and otherwise permits one current catalog-service line. It computes
  bounded subtotal, proportional taxable discount, tax, total, and a
  deterministic 14-day due date while leaving the payment URL empty.
- Existing active invoices produce no duplicate proposal. Unfinished jobs,
  cross-tenant or invalid pricing evidence, non-accepted quote data, and absent
  trusted pricing escalate. Technician notes, photos, parts, recommendations,
  and prompt-like text are never converted into charges. This policy is
  side-effect free; the delivered orchestration and guarded executor preserve
  that boundary and can save only an unsent editable draft after approval.
- Owner and office actors can now request an authoritative invoice evaluation.
  The database prefers the latest tenant-bound accepted quote snapshot and
  otherwise uses one enabled, non-archived catalog service. It reads the current
  tenant tax rate, computes bounded totals and a 14-day due date, and binds the
  exact proposal to a SHA-256 pricing-state version.
- An active non-void invoice produces an audited unchanged result. Missing or
  invalid trusted pricing escalates. Successful evaluations create governed
  run/trace evidence and an exact office approval only; the request path cannot
  write invoice tables, publish/email a link, create a payment URL, or record a
  payment.
- Approved invoice proposals now pass through an idempotent guarded executor.
  It revalidates the active office role, full subscription access, completed
  job, absence of another active invoice, accepted-quote or catalog pricing,
  current tax, exact approved amounts, and due date immediately before saving.
- Successful execution creates one editable draft with no payment URL and does
  not send it or record payment. Stale pricing, duplicate state, changed job
  state, or lost subscription access is retained as an audited guarded
  rejection. The AI Operations screen executes after approval and supports a
  safe retry after an interrupted request.
- The first Follow-Up Agent policy is deterministic and side-effect free. It
  proposes progressively firmer but respectful transactional reminders only on
  the business-local 3, 7, and 14-day overdue milestones for sent or partially
  paid invoices with a remaining balance.
- Paid, fully recorded, void, draft, duplicate-milestone, suppressed, invalid,
  and contact-disallowed cases produce no reminder. Optional review requests
  are proposed exactly two business-local calendar days after recorded or
  provider-confirmed settlement and require explicit marketing-email opt-in.
- Every proposed message has a stable invoice/milestone dedupe key, identifies
  manual versus provider-confirmed payment state, and requires human approval.
  The policy itself remains side-effect free.
- A daily database scheduler now evaluates eligible invoices in each company's
  time zone, applies AI enablement/budget and full-subscription checks, and
  persists one provider-neutral message plus governed run, trace, and exact
  approval per unique invoice milestone. Customer-level suppression blocks
  both reminder and review proposals.
- Approved Follow-Up messages pass through an idempotent guarded executor. It
  revalidates the office actor, subscription, invoice/payment state, customer
  contact and preferences, suppression, exact approved content, state hash,
  and milestone before moving the message from awaiting approval to ready.
  Ready messages are not marked delivered and no provider call is made.
- Actual email delivery remains intentionally disabled until a production
  sender/domain is supplied. The durable queue already includes bounded retry,
  provider-reference, ready, delivered, failed, and cancelled state fields for
  that later worker.
- Owners now have a Knowledge Base workspace for PDF, DOCX, and TXT uploads.
  The browser creates an owner-bound short-lived reservation, computes a local
  SHA-256 claim, writes only to the private quarantine path, and finalizes the
  exact size/type reservation. Owners can create a version against an existing
  logical document, inspect retained pipeline state, and archive a version;
  office staff have read-only visibility. Uploaded content remains unavailable
  to retrieval until a service-role scanner and safe parser succeed.
- A reusable FR-068 adversarial evaluation matrix now covers all four agent
  kinds across price grounding, cross-tenant isolation, prompt injection, tool
  authorization, hallucination resistance, and mandatory human escalation.
  Stable fixture IDs are replayed to prove deterministic outcomes. Separate
  database checks retain AI enablement/budget gates and pending-approval denial
  coverage for every side-effecting agent.
- The Intake Agent now has a deterministic quote-and-slot proposal policy. It
  validates completed contact/address/problem/service fields, uses only the
  confirmed enabled tenant catalog price, and reuses Dispatcher eligibility
  checks to return the earliest two future slots with an eligible technician.
  Foreign records, invalid pricing, unsafe duration, or fewer than two verified
  slots escalate. Output is an exact approval-required proposal only; it cannot
  create a customer, job, quote, assignment, or booking.
- Owner and office users can now request the Intake proposal from a completed
  inbox conversation. The authoritative database path re-reads the conversation,
  enabled service, current catalog price and tax, active technicians, normalized
  skills, exact ZIP coverage, weekly availability, time off, and job conflicts.
- Eligible evaluations persist a governed run, redacted trace, exact quote and
  two non-reserved slot options, SHA-256 state binding, and mandatory office
  approval. Missing coverage or fewer than two verified slots escalate without
  creating business records.
- Approved Intake proposals now pass through an idempotent guarded executor.
  It revalidates the actor, full subscription access, conversation, service,
  pricing, tax, exact approved payload, and both slots before creating exactly
  one customer, one unscheduled new job, and one editable draft quote. It never
  assigns a technician, reserves a slot, sends a quote, or confirms a booking.
- Each successful Intake conversion now persists exactly two public-safe slot
  offers from the approved payload. The hashed Intake session may poll only the
  bounded service, estimate total, business time zone, and offer timestamps;
  technician identity and privileged job/customer data are never returned.
- A customer may select one still-eligible preference. Selection revalidates
  active technician status, skills, ZIP coverage, availability, time off, and
  conflicts, withdraws the alternate option, and writes an anonymous-token
  audit event, but it does not assign or schedule the job.
- The office inbox displays the selected preference. Final confirmation is an
  explicit owner/office action that requires full subscription access, prior
  signed quote acceptance, an accepted job, and another current eligibility
  check before advancing the job to scheduled. Repeated confirmation is
  idempotent and queues the existing assignment/schedule notifications.
- Customers and office staff can now request two fresh Intake preferences when
  offered times expire or later eligibility changes. Each replacement reruns
  current skill, ZIP, availability, time-off, and conflict checks, excludes all
  prior suggestions, retains old generations as withdrawn/expired evidence,
  and exposes only the latest public-safe pair.
- Replacement generation is session- or office-authorized, audited, capped at
  five total generations, and remains a preference-only action. It never
  assigns a technician, reserves time, changes price, or schedules the job;
  quote acceptance and guarded office confirmation are still required.

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
- Report invoice policy tests cover accepted-quote precedence, catalog fallback,
  taxable/non-taxable totals, deterministic due dates, duplicate prevention,
  cross-tenant rejection, invalid values, prompt-like catalog text, exact diffs,
  and the no-field-evidence/no-payment-link boundaries.
- Report invoice orchestration tests cover office/tenant authorization,
  accepted-quote precedence, enabled catalog fallback, duplicate prevention,
  budget enforcement, pricing-state binding, idempotency, escalation, exact
  approvals, and absence of invoice/payment/customer side effects.
- Report invoice guarded-execution tests cover pending-approval denial, exact
  quote-line and total persistence, unsent/no-payment-link state, idempotency,
  audit evidence, and stale catalog-price rejection without invoice mutation.
- Follow-Up policy tests cover all three reminder tones and milestones,
  business-time-zone calendar handling, paid/void/full-balance stops,
  milestone and review deduplication, transactional suppression, marketing
  opt-in, settlement-source disclosure, cross-tenant denial, malformed data,
  and prompt-like customer names.
- Follow-Up orchestration tests cover scheduled proposals, AI/subscription
  boundaries, persisted dedupe, paid/void/suppressed stops, exact approvals,
  tenant isolation, pending-approval denial, guarded ready-state execution,
  idempotency, no false delivery claim, changed-suppression rejection, traces,
  and audit evidence.
- Intake orchestration tests cover office-role enforcement, authoritative
  pricing and tax, exactly two eligible slots, proposal-only behavior, pending
  approval denial, guarded draft creation, no assignment/reservation/send, and
  idempotent conversion evidence.
- Public Intake slot tests cover hashed-session status, two-option output,
  technician-data minimization, selection without booking, quote-acceptance
  gating, office confirmation, exact scheduling, idempotency, and the confirmed
  public state.
- Replacement-slot tests cover wrong-token denial, retained prior generations,
  exactly two fresh options, latest-generation public projection, continued
  technician-data minimization, selection, and the no-auto-booking boundary.
- Governed replay tests cover cross-tenant denial, fresh current-policy
  evaluation, distinct run and approval evidence, proposal-only behavior,
  immutable provenance, and idempotent retries.
- A provider-neutral activation boundary now defaults to the deterministic
  stub, requires an explicit deployment approval for live mode, validates
  server-only credentials and bounded token/cost/timeout settings, and rejects
  unapproved provider or model identities.
- Live model responses are fail-closed on incomplete output, identity mismatch,
  invalid usage, token/output/cost overruns, and every attempted tool call.
  Provider output remains proposal-only and cannot invoke business mutations.
- A reusable live-provider evaluation gate covers all four governed agents and
  enforces safety-critical case success, minimum quality pass rate, p95 latency,
  per-request limits, and aggregate evaluation cost. Reports retain only fixture
  IDs, bounded usage, duration, and sanitized failure codes.
- The OpenAI Responses adapter is server-only, sends stateless structured-output
  requests with `store: false`, exposes no tools, normalizes approved dated model
  snapshots, sanitizes provider failures, and applies conservative token-cost
  accounting before the shared activation boundary.
- Eight synthetic staging fixtures cover normal and prompt-injection behavior
  for Intake, Dispatcher, Report, and Follow-Up. Every case requires grounded
  identifiers, an explicit human-approval flag, and a bounded proposal or
  escalation. The owner-only staging control reports only aggregate results.
- On 2026-10-26 the hosted staging evaluation for `gpt-6-luna` passed all 8/8
  cases. Sanitized evidence recorded a 2,645 ms p95 duration and an $0.08
  estimated total cost. No tool access or live business mutation was enabled.
- The Dispatcher is the first proposal path wired to the evaluated model. Its
  authoritative database policy always runs first and remains the sole source
  of technician eligibility and the exact proposed assignment. The model may
  only explain that result with grounded IDs and cannot change the outcome.
- Dispatcher provider calls use strict JSON-schema output, `store: false`, an
  empty tools list, a 30-second timeout, a 300-token output cap, and a two-cent
  request cap. Identity drift, tools, invented IDs, changed outcomes, malformed
  output, excessive usage, missing credentials, and provider outages retain the
  deterministic proposal as a safe fallback.
- Only the service-role Edge Function can attach bounded OpenAI usage metadata
  and a redacted immutable review step to an authorized Dispatcher run. Browser
  clients cannot forge provider/model/cost records, and every changed assignment
  still enters the existing human approval and guarded execution path.
- On 2026-10-27 a hosted Dispatcher escalation completed with `gpt-6-luna` in
  1.6 seconds using 311 total tokens and a conservative one-cent recorded cost.
  The model preserved the authoritative no-candidate result, created no
  approval or mutation, and added only the redacted provider-review trace.
- The Intake proposal action now follows the same fail-closed provider boundary.
  The authoritative database result is created first; the model may only return
  a strict grounded explanation with the conversation and existing approval IDs.
  Missing credentials, provider failure, output drift, invented IDs, tools, or
  usage overruns retain the deterministic result. The provider cannot create a
  customer, job, quote, assignment, slot reservation, or booking.
- The Report Agent source path now applies the bounded provider review to both
  work-report and invoice-draft proposals. Completed-job screens expose separate
  `Prepare AI draft` controls, while the authoritative database policies remain
  the only source of report evidence, quote/catalog pricing, totals, and exact
  proposed changes. The model receives only the trusted outcome and bounded
  grounding IDs; it cannot save, publish, send, charge, or record payment.
- Scheduled Follow-Up proposals now enter a private durable provider-review
  queue. A service-authenticated worker claims at most four leased jobs, sends
  only bounded run/approval/message/invoice IDs and the deterministic outcome,
  rejects tools or changed results, and records redacted usage evidence. Failed
  reviews retry with bounded exponential backoff and stop after five attempts.
  The review never changes the exact queued message, approves it, or sends it.

## Next Phase 6 slices

1. Run authenticated staging acceptance for the already deployed Intake,
   Report/Invoice, and Follow-Up provider paths. Verify provider-reviewed,
   credential-absent fallback, human approval, guarded execution, idempotency,
   and redacted audit evidence. Dispatcher no-candidate acceptance has passed;
   its eligible-candidate approval/execution case remains.
2. Deploy the delivered authenticated `apps/scanner` ClamAV gateway on a
   private network, configure its HTTPS endpoint and bearer credential, enable
   the Vault-backed cron, and run the TXT, DOCX, PDF, infected-file, and
   retry-exhaustion staging acceptance matrix.
3. Keep production live mode disabled until an explicit owner decision records
   final monthly cost caps, retention, and rollback policy.

## Requirement status

- FR-060: Intake collection, office takeover, deterministic trusted-price quote
  drafting, two-slot availability policy, authoritative database orchestration,
  approval persistence, guarded draft execution, public slot preference, and
  guarded office booking confirmation are delivered. Bounded customer/office
  replacement generations after expiry or changed eligibility are delivered
  without weakening the final confirmation boundary. The bounded OpenAI review
  integration is deployed and awaits hosted staging acceptance.
- FR-061: Deterministic proposal policy, authorized data loading, governed
  persistence, UI invocation, human approval, and guarded execution are
  delivered. The bounded OpenAI review path is delivered for staging without
  granting the model eligibility authority, tool access, or mutation rights.
- FR-062: Deterministic, evidence-bounded report drafting policy, authorized
  orchestration, governed persistence, exact office approvals, and guarded
  editable-draft saving are delivered. Deterministic invoice policy is
  delivered with trusted invoice orchestration, exact approval persistence,
  and guarded editable-draft saving. Sending and payment remain separate
  human-controlled workflows. Bounded work-report and invoice provider-review
  integrations plus their job-screen request controls are deployed and await
  hosted staging acceptance.
- FR-063: Deterministic reminder/review policy, contact checks, local-day
  milestones, dedupe keys, payment-source disclosure, and mandatory approval
  are delivered. Daily orchestration, persisted provider-neutral delivery
  queue, customer suppression, exact approvals, and guarded ready-state
  execution are delivered. A Resend delivery worker with claim-time revalidation,
  idempotent sends, bounded retries, and webhook suppression is delivered for
  transactional reminders; live delivery awaits a verified sending domain.
  Review requests stay unsent until an unsubscribe flow and counsel approval
  exist. The bounded scheduled provider-review queue and worker
  are deployed to staging and await hosted acceptance.
- FR-064: Settings/plan budget enforcement and bounded usage metadata are
  delivered. All four agent kinds now have service-controlled provider
  usage/cost recording; final hosted acceptance remains pending for Intake,
  Report, and Follow-Up.
- FR-065: Inspectable, expiring, role-controlled, single-use approvals and the
  human decision UI are delivered. All currently implemented side-effecting
  agent actions use typed guarded executors with current-state revalidation.
- FR-066: Database security foundation, owner upload/version/archive UI,
  durable service-only queue, authenticated ClamAV gateway, fail-closed scan
  adapter, bounded TXT/DOCX/PDF parser, retries, leases, scheduling contract,
  tenant-scoped retrieval, and immutable evidence are delivered. Staging
  activation and acceptance remain gated by private gateway/ClamAV hosting and
  runtime credentials.
- FR-067: Immutable redacted run/step traces, inspection UI, and authorized
  deterministic replay controls are delivered. Replay re-enters current
  policy, permission, budget, and state checks to create a distinct proposal
  and approval; it never reuses a decision or executes the change. Every
  provider review remains proposal-only and service-role recorded.
- FR-068: Deterministic agent-specific adversarial fixtures are delivered for
  price grounding, tenant isolation, prompt injection, tool authorization,
  hallucination resistance, escalation, replay stability, and budget gates. A
  provider-neutral live evaluation harness now enforces all-agent quality,
  safety, latency, and cost thresholds. The OpenAI Responses adapter and eight
  synthetic `gpt-6-luna` staging fixtures are delivered. The hosted run passed
  8/8 cases at 2,645 ms p95 and $0.08 estimated total cost. Dispatcher hosted
  escalation acceptance passed on 2026-10-27. All four provider integrations
  are deployed to staging; hosted business-flow acceptance remains pending for
  Intake, Report/Invoice, and Follow-Up plus the eligible Dispatcher case.
