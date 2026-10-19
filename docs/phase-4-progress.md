# Phase 4 progress: mobile field execution

Updated: 2026-10-19

Phase 4 is in development. The first field-execution slice builds on the
existing technician sign-in and assigned-job views without granting broad
browser update access to job records.

## Delivered in this slice

- An assigned active technician can advance a scheduled job to `in_progress`
  and an in-progress job to `completed` from the mobile job detail view.
- Starting a job supports an optional field note; completing a job requires a
  meaningful completion note.
- Field notes are immutable, tenant-bound records with a 2,000-character cap.
- The database command locks the job, rechecks the current assignment, active
  membership, exact lifecycle transition, and note requirements atomically.
- Direct anonymous access, direct technician inserts, cross-tenant reads, and
  updates by another technician remain blocked.
- Owners and office staff can review technician field notes on the web job
  detail page, and note creation is represented in the immutable audit trail.
- Technicians can capture before photos on scheduled or in-progress work and
  after photos once work is in progress; photos are resized, JPEG-compressed,
  and limited to 5 MB before upload.
- Photo uploads use short-lived database reservations, exact tenant/job-scoped
  object paths, assignment checks, private storage policies, and an explicit
  finalize step that verifies stored type and size.
- Interrupted photo authorization, storage upload, and finalization can be
  retried in the same app session without recapturing the image. Ambiguous
  upload failures verify finalization first, stale unused reservations renew,
  and the technician can explicitly discard an unavailable pending image.
- Pending photos now survive app restarts in account-scoped private app storage,
  with encrypted chunked queue metadata, per-job recovery badges, persisted
  reservation/finalization progress, a 20-item bound, and automatic seven-day
  expiry plus account-scoped orphan cleanup.
- Expired, unfinalized server reservations are claimed in bounded retryable
  batches after seven days. A secret-key-only Edge Function removes physical
  objects through the Storage API before deleting metadata, preventing orphaned
  storage files and races with late technician finalization. Supabase Cron now
  invokes the cleanup function hourly through `pg_net`.
- Owners, office staff, and the currently assigned technician can view only
  finalized photos; the web app streams them through an authenticated no-store
  route without exposing raw bucket URLs.
- Photo metadata and objects deny anonymous access, cross-tenant reads, direct
  metadata mutation, unreserved paths, and uploads by another technician.
- An assigned technician can hand an in-progress job to the customer for a
  native signature drawing, signer-name confirmation, and explicit consent.
- Signature strokes use bounded normalized coordinates and are recorded once
  as immutable tenant/job evidence with a server timestamp, SHA-256 integrity
  hash, and audit event; owners and office staff can review the signed evidence
  on the web job page.
- Altered consent, malformed or oversized strokes, duplicate signatures,
  anonymous calls, cross-tenant access, direct mutation, and capture by another
  technician are denied.
- Owner and office memberships now receive a tenant-scoped mobile
  operations overview with today's schedule, unassigned work, active/open job
  metrics, unpaid invoice status, and draft quote/invoice/report approvals.
- Owner mobile views include recorded monthly revenue and invoice outstanding
  amounts; office views omit those financial totals and never request payment
  ledger rows.
- Owners and office staff can open a draft approval, review document-specific
  details, explicitly confirm publication, and share the returned customer
  link. The existing tenant/role-guarded database commands remain the only
  write path, and technicians cannot invoke the mobile action.
- Mobile members can explicitly enable or disable notifications per app
  installation and independently opt out of job assignments, schedule changes,
  cancellations, and approval requests. Expo tokens are private, tenant-bound,
  rotated safely, and disabled on sign-out or when Expo reports an invalid
  device.
- Assignment, reschedule, cancellation, and draft approval changes create
  generic transactional notification events. Per-device deliveries use
  idempotency keys, bounded claims, retry leases, exponential backoff, and a
  terminal failure state through a secret-key-only Edge Function.
- Notification taps use strict CrewFlow deep links and recheck the signed-in
  membership plus the loaded tenant-scoped job or approval before opening it.
  Customer names, addresses, document values, and public tokens are never
  included in the notification payload.
- Supabase Cron invokes the bounded push delivery Edge Function every minute
  through `pg_net`. The project URL and service credential remain encrypted in
  Vault, and only service-role commands can configure or inspect the job.
- Assigned technicians can review a newest-first job timeline covering job
  creation, scheduling/assignment, status changes, field notes, private photo
  completion, and customer signature capture. Only known safe metadata is
  formatted; unknown audit payload fields are never rendered in the mobile UI.
- Technician progress notes are saved as encrypted, account-scoped device
  drafts while typing and survive app restarts for up to seven days. Failed
  online status updates retain the draft for an explicit retry; CrewFlow never
  auto-submits a status change. If the job or intended transition changes, the
  draft is blocked until the technician explicitly rebases or discards it.
- Branded iOS/Android icon, Android adaptive and notification icons, and native
  splash assets are configured. Expo development-client support and separate
  physical-device, simulator, preview, and production EAS profiles are ready
  for owner-controlled project linking and credentials.
- A public staging privacy-notice route and draft App Store/Play Store metadata,
  privacy-label inventory, build runbook, and external release checklist are
  documented. The notice remains a pre-launch draft pending final contact,
  domain, and legal review.

## Remaining Phase 4 work

- Installed-device photo capture/upload and retry smoke tests (including
  cross-restart offline retry; user verification still pending)
- Installed-device signature drawing and submission smoke tests
- Installed-device progress-draft restore, offline retry, discard, and
  stale-job conflict verification
- Installed development-build verification of assignment, schedule,
  cancellation, approval, token-rotation, opt-out, and deep-link behavior
- Installed-device owner/office overview and guarded approval-action
  verification
- Owner-controlled Expo project linking, Android/iOS test-build execution, and
  installed device or simulator verification
- Final support contact/domain, counsel-approved privacy notice, store
  screenshots, signing credentials, and store-console submission

## Requirement status

- FR-050: Delivered in application code - single-membership sign-in, assigned
  jobs, customer/location context, guarded status actions, field-note history,
  and a tenant/assignment-authorized job timeline are implemented;
  installed-device verification remains.
- FR-051: Partial - guarded private capture, compression, type/size validation,
  upload, authorized viewing, in-session retry/discard, and durable
  cross-restart recovery are implemented; installed-device verification
  remains.
- FR-052: Delivered in application and database code - native drawing, explicit
  consent, server timestamp, immutable job binding, integrity hash, audit event,
  and authorized web review are implemented; installed-device verification
  remains.
- FR-053: Delivered in application and database code - owner/office metrics,
  operational job lists, unpaid invoice status, detailed approval review,
  explicit confirmation, guarded publication, and customer-link sharing are
  implemented; installed-device verification remains.
- FR-054: Partial - private device registration, token rotation, granular
  opt-outs, transactional assignment/schedule/cancellation events, retryable
  Expo delivery, and role-authorized deep links are implemented. Draft customer
  document approvals also use the same safe delivery path. The PRD's AI-agent
  approval source depends on the Phase 6 approval queue; EAS project
  credentials and installed development-build verification also remain.
- FR-055: Partial - native icon/splash/notification assets, public draft privacy
  notice, draft store metadata, development-client dependency, and EAS build
  profiles are implemented. Owner-controlled EAS/store accounts, credentials,
  actual test builds, device verification, final contact/domain, screenshots,
  and legal review remain.
- FR-056: Delivered in application code - pending photos and progress-note
  drafts are durably recoverable across restarts, retries are explicit, status
  changes remain online-only, and stale job/transition conflicts block silent
  submission; installed-device verification remains.
