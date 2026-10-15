# Phase 2 progress: jobs and scheduling

Updated: 2026-10-15

Phase 2 is in development. The web scheduling slice now delivers tenant-safe
job records, workflow control, assignments, a responsive daily/weekly dispatch
board, and database-enforced dispatch rules.

## Delivered in this slice

- Job create, list, search, filter, edit, archive, and detail flows for Owner
  and Office roles.
- Read-only assigned-job list and detail access for Technician roles.
- Explicit database-enforced lifecycle from `new` through `closed`, with a
  separate `cancelled` terminal state and actionable UI errors for invalid
  transitions.
- Same-tenant composite foreign keys for customers, services, and technician
  memberships.
- Active-technician validation and PostgreSQL exclusion constraint preventing
  overlapping scheduled or in-progress jobs, including concurrent writes.
- Company-time-zone-aware schedule input and display with daylight-saving
  validation.
- Immutable job activity events for creation, edits, scheduling, status
  changes, and archival.
- Dashboard job metrics and customer-detail job history.
- Daily and weekly technician dispatch board with date navigation, search,
  job-detail links, and an explicit needs-dispatch queue.
- Service-level required skills matched case-insensitively against technician
  skills before assignment.
- Weekly availability validation in the company's IANA time zone and
  same-business-day schedule enforcement.
- Audited technician time-off creation/cancellation with overlap protection and
  automatic schedule blocking.
- Actionable assignment errors for overlap, availability, time-off, skill, and
  same-day violations.
- Mobile technician assigned-job list backed by existing job RLS, with
  business-time-zone schedules, active/history grouping, refresh and read-only
  customer, service, address and work-detail views.
- Mobile owner and office accounts remain safely limited to an access-verified
  message until their later-phase dashboards are implemented.
- Static migration contract tests and pgTAP coverage for tenant and technician
  job access.

## Still required for Phase 2

- Optional direct drag/drop rescheduling enhancement; board cards currently
  open the validated job editor for time-slot assignment.
- Service-area validation during assignment. Mapping and travel estimates
  remain provider-dependent and degrade gracefully while no vendor is chosen.
- Installed-build technician job-list smoke test on Android and iOS hardware or
  simulators.
- Run the pgTAP suite on Docker/Podman-enabled CI or a development workstation.
- Broader schedule concurrency and state-machine integration tests against a
  disposable PostgreSQL instance.

## Requirement status

- FR-010: Partial — job metrics are live; invoice/revenue metrics depend on
  Phase 3.
- FR-020: Partial — core job fields, filters, detail, assignment, and activity
  are live; quote/invoice/report/media sections depend on later phases.
- FR-021: Delivered for the proposed lifecycle.
- FR-022: Delivered — daily/weekly per-technician board, searchable dispatch
  queue, time-slot assignment, and conflict-safe writes are live.
- FR-023: Partial — active technician, service skills, weekly availability,
  time-off, and overlap checks are live; optional service-area/travel checks
  await a configured eligible mapping vendor.
- FR-024: Delivered for material job changes in this slice.
- FR-050: Partial - mobile technician sign-in, active membership enforcement,
  assigned-job list and read-only job details are delivered; status actions,
  timeline and task history belong to the field-execution phase.
