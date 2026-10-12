# CrewFlow — Product Requirements Document & AI Coding Agent Implementation Specification

**Version:** 1.0 (implementation planning baseline)  
**Date:** October 12, 2026  
**Status:** Ready for phased implementation, subject to explicitly flagged business/provider decisions  
**Audience:** Cursor, Claude Code, OpenAI Codex, developers, QA, designers, product owner  
**Market:** United States (English-language service businesses); **Operator location:** Pakistan  
**Product:** Multi-tenant AI-powered field-service-management SaaS, web + iOS + Android

> **IMPORTANT INSTRUCTION FOR AI CODING AGENTS:** This document describes the target product, not a command to build everything in a single pass. First inspect the repository, prepare the implementation plan and identify blockers. Implement one vertical slice at a time, running tests, migrations and security checks. Never claim a feature works without evidence. Never fabricate payment-provider approval, API credentials, compliance certificates, native app distribution, or external integrations. Any item marked **PROPOSED** is a recommended default, not an owner-confirmed fact.

## 1. Vision and commercial model

CrewFlow helps US HVAC, plumbing, electrical, cleaning, pest-control and similar home-service companies manage the entire job lifecycle: incoming customer inquiry → customer and job creation → estimate → acceptance → scheduling and dispatch → technician execution → photos/notes/signature → job report → invoice → payment tracking and follow-up. Four AI agents reduce repetitive administrative work without bypassing human approvals.

### 1.1 Confirmed business decisions

- The product brand is **CrewFlow** (working brand; domain/trademark still unverified).
- Target customers: **US home-service businesses**; US-centric address, phone, currency and time conventions.
- Operator runs the SaaS **from Pakistan**; legal entity and payment onboarding details remain open.
- **CrewFlow earns SaaS subscriptions only**. No CrewFlow commission, transaction markup or split on the service payments of subscriber businesses.
- **End customers pay the service business directly**. CrewFlow must not collect, custody, route, settle or hold the service business's customer funds.
- Web platform + installable Android and iOS apps, with owner, office and technician roles.
- Multi-tenant isolation: each subscriber company sees only its own data.
- Four AI agents: Intake, Dispatcher, Report, Follow-Up. Sensitive actions require human approval.
- Initial customer channels: website chat and email; **no WhatsApp in v1**.
- First external AI assistant integration, if shipped, is **read-only**.

### 1.2 Confirmed vs proposed vs open

**CONFIRMED** items originate in the owner's master product prompt and subsequent decisions. **PROPOSED** items below are technical/product defaults for implementation, subject to owner review. **OPEN** items cannot be asserted as facts or used to turn on live billing without a decision.

**OPEN:** exact subscription plans/prices and limits; free trial policy; registered legal entity and approved Paddle account; privacy/counsel review; email provider; map/geocoding vendor and costs; customer payment-provider integration feasibility; final brand/domain; technician mobile offline requirements; public review-site destination; exact job status machine and refund policy. Until settled, ship safe configuration-driven defaults, development fixtures and sandbox integration only.

### 1.3 Initial releases / priority

- **P0 Foundation:** tenant model, auth, onboarding, RBAC, audit log, settings, customers, services, staff, jobs, scheduling/conflict detection, responsive dashboard, mobile sign-in and assigned-job list, transactional email, billing entitlement enforcement behind a sandbox/provider adapter.
- **P1 Core business operations:** quotes with secure acceptance links, job completion with photos/notes/signature, reports requiring approval, invoices, external business payment links, manually recorded paid/unpaid state and follow-ups, push notifications, activity history.
- **P2 AI:** safe Intake, Dispatcher, Report, Follow-Up agents, human approvals, cost budgets, knowledge-base retrieval, evaluation suite and agent trace inspection. AI must never become required for basic manual job management.
- **P3 Expansion:** optional read-only external assistant interface, advanced reporting, production mobile store release, additional eligible direct-to-business payment integrations.

Dependencies may cause a P1 feature to be implemented alongside P0 if required for an end-to-end slice. Do not call unfinished items “delivered.”

## 2. Users, permissions and tenancy

| Role | Allowed scope |
|---|---|
| Platform operator/admin | CrewFlow subscription and infrastructure administration; audited, restricted support access; **no routine arbitrary access to tenant contents** |
| Business owner | Full company settings, staff, jobs, invoices, billing, integrations, AI policy, approvals and reporting |
| Office staff | Customers, quotes, schedule, dispatch, invoices, inbox and authorized approvals; no platform billing or owner-only security controls by default |
| Technician | Only assigned/relevant job information, status updates, photos, notes and signatures; no revenue-wide data or arbitrary customer browsing |
| End customer | Only their own token-scoped quote, invoice or conversation page; no account required for quote acceptance |

**Multi-tenancy nonnegotiables:** `tenant_id` on every tenant-owned record and audit event; authorization enforced server-side at every query and command, not merely in the UI. Membership and job assignment checks must occur before reading/writing. Tenant-scoped unique constraints and indexed foreign keys. Prefer PostgreSQL Row Level Security as a defense-in-depth mechanism if its operational complexity is managed. Cross-tenant access tests are release blockers. Never mix uploaded documents or retrieval indexes between tenants. Avoid logging customer sensitive data.

## 3. Core end-to-end journeys

1. Owner registers company, verifies email, completes onboarding (US time zone, services, hours, taxes and staff), configures company billing, and invites members.
2. Visitor asks service question using embeddable company chat widget. Intake asks one question at a time, references only that company's approved sources, creates a prospect/customer and draft job, and offers available appointment options with escalation when needed.
3. Office reviews incoming job, creates estimate from catalog, sends secure customer link, and records acceptance/decline.
4. Dispatcher suggests technician based on skills, working hours, active jobs and estimated travel; manual dispatcher can override. Never double-book. In-progress reassignment requires approval.
5. Technician receives assignment push, opens assigned job, records status, work notes, before-and-after media and customer signature, and completes work.
6. Report Agent drafts job report and invoice; office approves before report is sent.
7. Customer receives invoice with a **business-owned** payment link or offline payment instructions. Funds go to the service business independently of CrewFlow. CrewFlow updates its ledger only via authorized manual entry or verified integration events (if an approved eligible integration exists).
8. Follow-Up Agent follows configured unpaid reminders and optional post-payment review request, honoring contact preferences, time zones and deduplication.
9. CrewFlow invoices the **business** for SaaS subscription via its separate billing provider.

## 4. Detailed functional requirements and acceptance criteria

Each `FR-xxx` is independently testable. Unless marked **PROPOSED**, it maps to the confirmed master prompt.

### 4.1 Accounts, company and access

- **FR-001** Register/login with verified email and password; enforce sane password policy, rate limits and secure resets. **Accept:** reset links expire and are single use; invalid sessions rejected.
- **FR-002** Company onboarding captures legal/display name, service categories, contact details, operating hours, IANA time zone, USD currency and configured tax settings. **Accept:** records use one tenant; timestamps stored in UTC, rendered in business local zone.
- **FR-003** Invite owner/office/technician members by expiring email tokens; deactivate and remove access instantly. **Accept:** role and tenant authorization tested across all APIs.
- **FR-004** Staff skills, availability and service-area metadata editable by authorized users; deactivation retains historical job associations.
- **FR-005** Company owner manages notification settings, AI thresholds and billing entitlements.

### 4.2 Dashboard and CRM

- **FR-010** Dashboard shows today's jobs, unassigned jobs, unpaid invoices, monthly revenue, recent activity, technician/status summaries. **Accept:** aggregates tenant-scoped, time-zone aware, and consistently distinguish paid versus expected revenue.
- **FR-011** Customer CRUD/search with name, US phone, email, multi-line address, city, state, ZIP, notes and consent/preference flags. **Accept:** customer detail shows authorized jobs, invoices and lifetime paid spend.
- **FR-012** Service catalog CRUD with name, optional description, unit price in integer USD cents, default duration, enabled flag and tax behavior. Historical prices never silently change.

### 4.3 Jobs and scheduling

- **FR-020** Create/edit/view/filter jobs by customer, service, description, priority, status, owner, technician and local service dates. Job page includes quote, invoice, report, photos, signature, assignments and chronological activity feed.
- **FR-021** Enforce explicit job state machine. **PROPOSED:** `new → quoted → accepted → scheduled → in_progress → completed → closed`, with separately modeled `cancelled` and distinct quote/invoice/payment statuses. Paid status belongs to invoice, not the job lifecycle. Reject invalid jumps with actionable UI error.
- **FR-022** Daily and weekly dispatch board per technician, time-slot assignment, unassigned jobs panel and conflict warnings. **Accept:** concurrent scheduling attempts cannot double-book a technician; server transaction/unique constraint or serialized availability check resolves races.
- **FR-023** Dispatcher respects technician service skills, scheduled working hours, time off and overlapping jobs. Distance/travel estimates only if a configured eligible mapping vendor is available; degrade gracefully otherwise.
- **FR-024** Every material job change creates an immutable audit/activity event with actor and timestamp.

### 4.4 Quotes, invoices and **direct-to-business** payment model

- **FR-030** Draft quote from line items, quantities, tax configuration, discounts authorized by business policy, clear totals and expiration. Record acceptance/decline timestamp through expiring, signed, high-entropy, single-purpose customer link.
- **FR-031** Invoice from completed job/report; unique per-tenant invoice number, immutable snapshots of billable items, tax, due date, paid/outstanding amounts and status; owner can void with reason (not destroy history).
- **FR-032** An invoice can display a payment URL **provided and owned by the subscribing business**, such as a merchant's existing checkout/invoice/payment link. CrewFlow validates URL syntax/domain policy, clearly discloses the payee, and redirects the end customer. **No CrewFlow checkout or collection of service revenue.**
- **FR-033** Business staff may mark cash/check/external transfer as received manually with amount, timestamp, method, reference and performer; status explicitly identifies *manually recorded* settlement and supports partial payments/adjustments. Never interpret a clicked payment link as payment confirmation.
- **FR-034** If an actual eligible, business-direct gateway integration is later approved, implement it behind a provider adapter with signed webhooks, idempotency, event reconciliation and strict tenant-account association. **Do not assume Pakistan-based CrewFlow qualifies for Stripe Connect; do not build live Connect flows until eligibility is confirmed.** The owner-approved integration must ensure the service business, not CrewFlow, is the payee and operator of its own merchant account.
- **FR-035** Refunds/disputes for service payments take place with the business's provider. CrewFlow may display recorded status/reference only; no platform-triggered refund without separately approved scope and integration.
- **FR-036** Payment follow-ups stop once the invoice is recorded as fully paid; reminders are never duplicated. Explicitly show whether payment state is manual or provider-confirmed.

### 4.5 CrewFlow subscription billing (separate from service payments)

- **FR-040** CrewFlow charges companies monthly/annually for access; use **Paddle as proposed Merchant-of-Record provider**, contingent on seller approval and accepted Pakistan payout/identity documentation. Never embed secret keys in clients.
- **FR-041** Plans, prices, seat limits, AI spend caps, trial settings, proration, cancellation and tax terms are configuration-driven and **OPEN for business decision**. No hard-coded $ amounts in production logic.
- **FR-042** Paddle subscription events use verified webhooks, idempotent processing, entitlement sync, reconciliation jobs, renewal/cancellation status and a self-service billing portal where supported. Ignore any unsigned webhook. Never grant access based solely on a client redirect.
- **FR-043** Sandbox and stub billing provider must support local development; business-critical workflows remain testable without real money.
- **FR-044** Grace period, downgrade and suspension behavior require owner approval. Default to preserving company data and safe read-only access on payment issues rather than deleting customer records.

### 4.6 Technicians and mobile apps

- **FR-050** iOS/Android sign-in, account switching **within one company membership only** (no multi-business user capability in v1), assigned jobs, timeline, location/address display, status actions and task history.
- **FR-051** Capture/upload before-and-after photos with compressed media, content-type validation, private storage, authorization and retry logic. Never expose raw cloud bucket URLs publicly.
- **FR-052** Capture customer's electronic signature with recorded timestamp, job identifier and consent text; signature integrity/audit trail. Legal sufficiency for particular business use cases is not guaranteed.
- **FR-053** Owner mobile app provides metrics, jobs and approvals; office mobile view offers core job oversight (PROPOSED; can be phased).
- **FR-054** Push notifications for assignment, schedule move, cancellation and agent approval; tapping opens the correct authorized deep link. Token rotation, opt-outs and no secrets in message bodies.
- **FR-055** App icon, splash screen, store metadata, privacy policy and test builds for both platforms. Real App Store / Play Store publication depends on developer accounts, credentials and external reviews.
- **FR-056 PROPOSED** Offline draft notes/photo queue with explicit syncing/conflict UX; do not silently promise full offline-first operation before tested.

### 4.7 Four AI agents

AI calls are advisory tool orchestrations with deterministic guardrails, not all-powerful agents. Use explicit typed tools and server-side authorization. All actions run under a tenant, actor/agent identity, policy version, cost budget and correlation ID.

- **FR-060 Intake Agent:** embeddable website chat, one question at a time, captures contact/address/problem, maps service type, references only tenant's approved price list/knowledge docs, creates records only with valid fields, drafts quotes and offers two verified available slots, escalates uncertain cases. Office may take over conversation at any time. Never invent pricing/guarantees or change policies due to a visitor prompt.
- **FR-061 Dispatcher Agent:** proposes skills/availability/workload-aware assignments and rationale; execute only within allowed policy. No available technician → escalation. In-progress reassignment → explicit human approval.
- **FR-062 Report Agent:** drafts summary from technician notes and permitted before/after media, parts used and recommendations; marks unknown facts as unknown; drafts invoice; **office reviews and approves** outgoing report.
- **FR-063 Follow-Up Agent:** daily scheduler triggers overdue reminders at 3/7/14 days, progressively firmer yet respectful copy; no duplicates or reminders on paid/void invoices; review request two days after confirmed/recorded payment with contact-policy checks.
- **FR-064** AI spend budget configurable by tenant per billing month. Reaching limit disables *new AI operations* but not human-use core app; outstanding actions remain inspectable. Track model, tokens/cost estimate, run state, duration and prompts/tools with PII redaction.
- **FR-065** Human approval queue shows proposed action, rationale, exact diff/consequences, actor, creation/expiry and approve/reject choices; automatically expires in 48 hours; approval checks current role and current state again at execution time.
- **FR-066** Upload PDF/DOCX/TXT, FAQ, policies and price lists per business into segregated knowledge base; virus scan, type/size checks, safe parser, source citations, document versioning and retrieval scoped to tenant.
- **FR-067** Traces/replay show sequence of prompts (redacted), tool requests, responses, decisions, state and cost; replay must not cause unintended repeated external effects.
- **FR-068** Maintain evaluation fixtures for AI tasks: accurate price grounding, cross-tenant data leakage, prompt injection resistance, tool authorization, hallucination, human escalation and cost budget adherence.

### 4.8 External AI assistants (later phase)

- **FR-070** Read-only scoped interface to retrieve schedules and overdue invoices for an authenticated, authorized business member. Provider and protocol selection is PROPOSED. No mutation tools, no cross-tenant reads, revocable grants, audit all queries and rate-limit access.

### 4.9 Email, notifications, reports

- **FR-080** Transactional email templates for invite, quote, invoice, status, reminder and review request; send via queued jobs with retries, dedupe and provider delivery outcomes.
- **FR-081** Activity timeline, searchable inbox, audit and financial reports where role-authorized.
- **FR-082** Respect email consent/preferences, CAN-SPAM and other applicable US requirements; categorize transactional vs marketing messaging, support suppression and opt-out where required. Counsel to approve jurisdiction-specific compliance behavior.

## 5. Out of scope for v1

WhatsApp channel, fleet-wide route optimization, users belonging to multiple businesses, inventory/stock, payroll/commissions, non-English localization, in-app custody/splitting of service payments, CrewFlow-per-transaction charges, automated government tax filing, native accounting synchronization, advanced live GPS tracking and unapproved autonomous financial actions.

## 6. UX / visual design system

**Design intention (PROPOSED):** premium trustworthy B2B SaaS; clear high information density without visual clutter. The attached concept image illustrates direction, **not exact product requirements or production data**.

### 6.1 Style tokens

- Brand primary: `#1769F4` (clear blue); dark navy `#11223C`; page background `#F6F8FC`; white cards `#FFFFFF`; muted text `#64748B`; borders `#E2E8F0`.
- Success `#16A34A`; warning `#D97706`; danger `#DC2626`; informational `#2563EB`. Never convey status by color alone.
- Type: Inter/system UI; desktop body 14–16px; minimum accessible touch targets ~44px on mobile; 8px spacing rhythm; 10–14px card radius; accessible focus outlines.
- WCAG 2.2 AA goal: keyboard accessible web flows, labels, contrast, error explanation, reduced motion, screen reader semantics, focus management.
- Mobile uses platform-aware components, safe areas, bottom navigation and clear online/sync state. Responsive for small screens, tablet and desktop.

### 6.2 Screen inventory

| Surface | Required pages |
|---|---|
| Marketing website | Home, features, industries, pricing, FAQ, login, sign up, privacy, terms, contact |
| Web authentication | Register, verify email, login, password reset, invitations, onboarding |
| Owner/office web app | Dashboard, jobs list/detail, daily/weekly schedule, customers/list/detail, services, team, quotes, invoices, inbox, AI runs, approvals, knowledge base, reports, business settings, billing |
| Technician mobile | Login, today's jobs, job detail, directions handoff, photo capture, work notes, signature, status, notifications/profile |
| Owner mobile | Dashboard, recent jobs, approvals details and approve/reject, notifications, account |
| Public end-customer | Company chat widget, quote preview/accept/decline, invoice view and external business payment link |

**Marketing landing page:** top bar with logo + Features/Industries/Pricing/Login/Get started; strong hero/headline and two calls to action; product screenshot, trust/industry grid, outcomes, feature cards, mobile preview, pricing with prices from plan configuration, testimonials only when real, FAQ and footer.

**Web dashboard:** left sidebar navigation; top global search, tenant context and account menu; first row KPI cards; today's jobs table, alerts/approvals feed, activity list; scheduling calendar separately optimized for large screen. Empty/loading/error states mandatory.

**Technician mobile:** next-job card, daily appointment list with status, large job action buttons; job detail tabbed Details/Photos/Notes/History; add photos and signature without tiny controls.

**Owner mobile:** compact KPI cards, approvals card with clear reason, job details, confirmation modal before approval of risky operations.

### 6.3 Interaction rules

- Every destructive action needs confirmation and role check; high-impact AI actions require separately authorized approval.
- Forms autosave drafts only where safe; show validation near field; avoid losing input on network errors.
- Tables have sorting/filtering, search, pagination and useful empty states.
- Show visible loading and retry states for slow server, uploads and AI drafting; never imply a payment is complete until confirmed or manually attested.
- Public links expire/revoke and expose only intended record. No indexable private customer details.

## 7. Proposed architecture and technology

**Target codebase:** TypeScript-first modular monorepo with bounded contexts and separate Python AI service only when justified by specific orchestration needs. Strong preference for simplicity early: start as modular monolith + background workers, then extract services after measurement.

| Layer | Proposed stack | Reason |
|---|---|---|
| Web + marketing | Next.js + React + TypeScript | SEO landing pages, secure dashboard, shared type ecosystem |
| Web UI | Tailwind CSS + accessible component system | Consistent tokens, fast implementation |
| Mobile | React Native + Expo + TypeScript | iOS/Android from shared codebase, secure native modules |
| Backend | NestJS + TypeScript | Structured REST API, DI, policy modules |
| Database | PostgreSQL + Prisma or Drizzle (choose one) | Relational integrity, migrations, isolation |
| Jobs/queues | Redis + BullMQ (or managed equivalent) | Email, scheduling, reminder and agent tasks |
| Storage | S3-compatible private object storage | Photos, signatures, tenant docs |
| AI | Typed tool orchestration; optional Python LangGraph separate service | Audit/control; avoid unnecessary separate stack in first phase |
| SaaS billing | Paddle adapter (subject to eligibility) | SaaS subscriptions and recurring billing |
| Business receipts | Manual ledger + external business-owned links first | Clear payment separation; no CrewFlow handling of customer money |
| Email/push | Provider adapter; Expo Notifications/FCM/APNs as applicable | Swappable services, retry/observability |
| Observability | OpenTelemetry + structured logs/error reporting | Trace jobs, APIs and async workflows |

**Architecture guideline:** `apps/web`, `apps/api`, `apps/mobile`, `apps/worker` (optional), `packages/ui`, `packages/types`, `packages/config`, `packages/eslint-config`, `packages/tsconfig`, `packages/api-client`, `infra/`, `docs/`. Do not share server-only secrets, ORM models or privileged logic into frontend bundles. API uses OpenAPI-generated typed clients with stable schemas.

### 7.1 Backend modules

Auth & RBAC, Tenants & Memberships, Customers, Services, Staff, Jobs, Scheduling, Quotes, Invoices, PaymentRecords, SaaSBilling, Messaging, Notifications, Attachments, KnowledgeBase, AIAgents, Approvals, Audit, Reporting, Integrations.

Use API request validation, consistent error types, per-route tenant auth guards, rate limiting, pagination and versioned contracts as needed. Keep domain commands in services, not controllers.

### 7.2 Canonical data model (minimum)

All tenant objects carry UUID IDs and `tenant_id`, timestamps, and soft deletion or retention policy when warranted.

- `User`, `Session`, `Tenant`, `Membership`, `Invitation`, `TenantSetting`, `BusinessHours`, `TechnicianSkill`, `TimeOff`
- `Customer`, `Service`, `Job`, `JobAssignment`, `JobStatusEvent`, `JobPhoto`, `JobNote`, `JobSignature`
- `ScheduleSlot` (unique/serialized conflict enforcement), `Quote`, `QuoteLineItem`, `QuoteDecisionToken`, `Invoice`, `InvoiceLineItem`, `PaymentRecord`
- `Conversation`, `Message`, `EmailDelivery`, `Notification`, `DevicePushToken`
- `KnowledgeDocument`, `KnowledgeChunk`, `AgentRun`, `AgentStep`, `AgentToolCall`, `AgentPolicy`, `ApprovalRequest`, `ApprovalDecision`
- `Subscription`, `Plan`, `Entitlement`, `ProviderWebhookEvent`, `AuditEvent`, `OutboxEvent`

**Currency**: integer minor units and explicit currency code `USD`. Money arithmetic with decimal/integer, never binary float. Audit sensitive changes and preserve invoice/quote snapshots.

### 7.3 API examples (illustrative; finalize in OpenAPI)

```
POST /v1/auth/register
POST /v1/auth/login
POST /v1/tenants
GET  /v1/dashboard/summary
GET|POST /v1/customers
GET|POST /v1/jobs
GET|PATCH /v1/jobs/{jobId}
POST /v1/jobs/{jobId}/assign
POST /v1/jobs/{jobId}/status
GET /v1/schedule?date=YYYY-MM-DD
POST /v1/quotes
POST /v1/quotes/{id}/send
POST /public/quotes/{token}/decision
POST /v1/invoices
POST /v1/invoices/{id}/record-payment
POST /v1/invoices/{id}/send
GET|POST /v1/agent-runs
POST /v1/approvals/{id}/approve
POST /v1/approvals/{id}/reject
POST /webhooks/paddle
```

Public routes apply purpose-limited signed tokens, throttle, expiry and anti-enumeration. `tenant_id` is inferred from secure membership/context, **never trusted directly from arbitrary user JSON**.

### 7.4 AI safety and approval execution

Use a state machine: `proposed → pending_approval → approved/rejected/expired → executing → executed/failed`. Approver must not approve after action is stale; revalidate permissions, facts, quotes, amounts, schedule conflicts and policy. Restrict tool allowlists; prompt text/documents are untrusted; do not let retrieval snippets override policy. Separate draft text generation from permission to commit persistent changes. Use transactional outbox/idempotency for side effects; no agent gets unrestricted database credentials.

## 8. Security, privacy and reliability requirements

- Security baseline: OWASP ASVS-inspired practices, least privilege, MFA for owner/admin **PROPOSED**, secure token storage on mobile, HttpOnly/Secure/SameSite cookies on web; CSRF defense as appropriate.
- Passwords hashed with established adaptive scheme (Argon2id recommended) and managed reset flows. Credential/session revocation, login throttling and suspicious-auth alerts.
- Encryption in transit and managed encryption at rest; secrets only server-side secret manager; never commit `.env` secrets; automated secret scanning.
- File uploads validated, scanned, type/size limited, private and authorized; stripping sensitive metadata where appropriate; signed short-lived access URLs.
- Keep PII minimal; log redaction, per-tenant access trails, configurable retention/deletion/export requests and backups. No unsupported claims of HIPAA, SOC2, PCI or full US legal compliance.
- Webhook signatures verified, dedupe events; schedule jobs idempotently. Agent and payments have reconciliation routines and dead-letter queues.
- Database migrations reviewable with tested rollbacks or compensating migration; nightly backup schedule and restore drills **PROPOSED**.
- Contact/legal review for privacy notices, email marketing, service tax details and cross-border processing is a launch gate.

## 9. Performance targets (PROPOSED service level objectives)

Measure in staging and production; do not claim targets met until instrumented.

- Core dashboard API p95 < 500ms under documented baseline load (excluding AI and third parties).
- Standard CRUD API p95 < 400ms for indexed/paginated queries under baseline load.
- Web Core Web Vitals goal: LCP < 2.5s, INP < 200ms and CLS < 0.1 on representative mobile conditions.
- UI remains responsive; long-running email, PDFs, AI and reminders execute asynchronously.
- Paginate/filter lists server-side; use query indexes and avoid N+1 queries.
- Monitor uptime, errors, queue depth, saturation, AI spend and webhook failures. Document workload assumptions before sizing infrastructure.

## 10. Testing and quality gates

Required automation at pull request level: formatting, lint, strict TypeScript, dependency audit, unit tests, integration tests, API schema generation, migration checks, relevant mobile/web builds and secrets scan.

**Required integration/e2e scenarios:**

1. Tenant A cannot read or modify Tenant B records even by guessing IDs, uploads or vector searches.
2. Technician cannot access unrelated jobs or owner subscription settings.
3. Job state transitions valid/invalid cases; no double-booking under concurrent requests.
4. Quote generation/expiry/acceptance and duplicate decision handling.
5. Invoice totals/tax rounding, partial payment manual entries and voiding behavior.
6. Clicking an external service-business payment link NEVER marks invoice paid.
7. Paddle sandbox signed webhook creates/renews/cancels entitlement exactly once even on retries/out-of-order event sequences.
8. Approval expires, actor loses permission, stale price/schedule → action must not execute.
9. Prompt injection in customer chat or uploaded PDF cannot change system pricing, roles or tenant scope.
10. AI disabled by budget does not block normal job processing.
11. Follow-up reminder runs twice but sends at most one message at each interval.
12. Push deep links reject unauthorized accounts; mobile upload retry resolves without duplicate attachments.
13. Core mobile apps run on tested Android and iOS device/simulator versions.
14. Accessibility keyboard and screen reader checks on key journeys.
15. Backup restore and security incident runbooks tested before launch.

No deployment if critical/high security vulnerabilities or core e2e tenant separation tests fail. Define coverage thresholds per module; do not use raw test count as proof of correctness.

## 11. Deployment and operations

Use development, staging and production environments with separate DBs, storage, credentials, payment webhooks and AI keys. Start with managed hosting and PostgreSQL, job queue, private storage, centralized observability, alerting, automated backups, HTTPS, CDN and WAF/rate limiting. CI/CD: deploy staging on merge, run smoke tests, then explicitly approve production deploys. Support database version compatibility across rollback windows. Infrastructure as code and maintenance runbooks are required.

**Mobile publishing:** signing, app identifiers, Apple/Google developer programs, data-safety declarations, privacy URLs, screenshots and actual store review are external tasks; an AI agent cannot substitute for required account ownership.

## 12. Implementation plan for Cursor / Claude Code / Codex

**Phase 0 — Repository foundation:** architecture decision record, monorepo, lint/format/type/test CI, Dockerized local Postgres/Redis, env templates, OpenAPI plan, UI tokens, mock fixtures, initial threat model.

**Phase 1 — Identity + tenancy:** authentication, membership RBAC, company onboarding, services/team/customers, tenant isolation tests, audit infrastructure.

**Phase 2 — Jobs + scheduling:** CRUD, workflow state machine, assignments and concurrent conflict prevention, responsive dashboard; mobile read-only job list.

**Phase 3 — Quotes + invoices:** secure public quote acceptance, invoice creation, external business payment link and manual payment ledger, emails, report draft workflow; no gateway fund custody.

**Phase 4 — Mobile field execution:** photo upload, notes, signatures, status, push notifications, owner views and approvals.

**Phase 5 — SaaS billing:** Paddle sandbox adapter and verified webhook entitlement sync; only promote to live mode after legal entity/account/provider acceptance and approved plan configuration.

**Phase 6 — AI agent platform:** tool policy, approval engine, bounded costs, audit traces, evaluations; ship one agent at a time starting with Intake.

**Phase 7 — Hardening and release:** security tests, performance tuning, accessibility, backup restore, email deliverability, production smoke tests, privacy/legal review, stores submission.

**At each phase**, coding agent must produce: files changed, migrations, sample env values with no secrets, tests executed and results, demo instructions, unresolved questions, risks, and a checklist matching requirement IDs. Do not start the next phase until the previous phase's acceptance criteria pass.

### 12.1 First prompt to coding agent

> Read `CrewFlow_PRD.md` fully. Do not implement the entire project at once. First inspect the repository and give me (1) concise architecture plan and assumptions, (2) proposed monorepo structure, (3) security and payment-model boundaries, (4) milestones mapping requirement IDs to phases, (5) list of decisions that block production rollout. Then implement only Phase 0 with tests and developer setup instructions. Do not deploy, configure real payments, spend money, or publish mobile apps without explicit permission. Always maintain tenant isolation and never invent integrations or credentials.

## 13. Business decisions to resolve before production release

1. CrewFlow's legal company/person registration, tax advice, Paddle seller approval, and verified payout to Pakistan.
2. Pricing plans (monthly/annual), trial, billing grace period and seat/AI limits.
3. Who sends customer emails and the sending-domain/provider verification.
4. Whether businesses only paste their own third-party payment URLs or a verified merchant-provider integration is possible; **no reliance on a Stripe Connect arrangement without explicit eligibility review**.
5. Service business invoice taxation configuration, correct wording for off-platform payment confirmations, and refund/reconciliation responsibilities.
6. Whether mobile offline behavior is required for first release.
7. AI model/data retention choices, document size/retention policy and actual monthly cost caps.
8. Contact opt-in and review solicitation policies for intended US regions.
9. Final brand/domain clearance and legal policies.

## 14. Source and product-design notes

This specification consolidates the user-provided 9-part screenshot master prompt, the user's approved CrewFlow name and US audience, and the latest explicit commercial decision that **CrewFlow takes only SaaS subscriptions while end customers pay service businesses directly**. Proposed engineering choices are labeled and should be validated before implementation. Marketing UI mockup is illustrative and may contain demo data that must not be interpreted as product requirements.

**Provider verification sources (checked October 2026):**
- Paddle, support for Pakistani businesses: https://www.paddle.com/billing/pakistan
- Paddle, seller-country exclusions/eligibility: https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle
- Paddle, payout timing/methods: https://www.paddle.com/help/manage/get-paid/when-and-how-do-i-get-paid
- Stripe Connect overview (only for future eligibility research): https://stripe.com/connect

---
**END OF CREWFLOW PRD v1.0**
