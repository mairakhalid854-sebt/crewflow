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

## Remaining Phase 4 work

- Installed-device photo capture/upload and retry smoke tests (including
  cross-restart offline retry; user verification still pending)
- Installed-device signature drawing and submission smoke tests
- Richer task/timeline history and offline field-progress draft/sync conflict
  handling
- Installed development-build verification of assignment, schedule,
  cancellation, approval, token-rotation, opt-out, and deep-link behavior
- Installed-device owner/office overview and guarded approval-action
  verification
- App icon, splash screen, privacy/store metadata, test builds, and installed
  Android/iOS device or simulator verification

## Requirement status

- FR-050: Partial - sign-in, assigned jobs, customer/location context, guarded
  status actions, and field-note history are implemented; richer task history
  remains.
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
  credentials, scheduled worker deployment, and installed development-build
  verification also remain.
- FR-055: Partial - Expo application configuration exists; release assets and
  store/test-build work remain.
- FR-056: Partial - pending photos are durably recoverable across restarts, but
  field-progress commands still require a live connection and full offline
  draft/sync conflict handling remains.
