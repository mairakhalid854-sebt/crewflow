# Phase 4 progress: mobile field execution

Updated: 2026-10-16

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

## Remaining Phase 4 work

- Installed-device photo capture/upload smoke tests and explicit retry/recovery
  UX for interrupted uploads
- Installed-device signature drawing and submission smoke tests
- Richer task/timeline history and offline draft/sync conflict handling
- Assignment and schedule push notifications with token rotation and opt-outs
- Owner/office mobile metrics, jobs, and approval views
- App icon, splash screen, privacy/store metadata, test builds, and installed
  Android/iOS device or simulator verification

## Requirement status

- FR-050: Partial - sign-in, assigned jobs, customer/location context, guarded
  status actions, and field-note history are implemented; richer task history
  remains.
- FR-051: Partial - guarded private capture, compression, type/size validation,
  upload, and authorized viewing are implemented; installed-device and
  interrupted-upload retry testing remain.
- FR-052: Delivered in application and database code - native drawing, explicit
  consent, server timestamp, immutable job binding, integrity hash, audit event,
  and authorized web review are implemented; installed-device verification
  remains.
- FR-053: Not started beyond safe access verification for owner/office users.
- FR-054: Not started.
- FR-055: Partial - Expo application configuration exists; release assets and
  store/test-build work remain.
- FR-056: Not started; the current field-progress command requires a live
  connection and does not claim offline-first behavior.
