# Phase 2 progress: jobs and scheduling

Updated: 2026-10-14

Phase 2 is in development. The first vertical slice delivers tenant-safe job
records, workflow control, assignments, schedule conflict prevention, and the
initial responsive web experience.

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
- Static migration contract tests and pgTAP coverage for tenant and technician
  job access.

## Still required for Phase 2

- Daily and weekly drag/drop dispatch board and an explicit unassigned queue.
- Skill, weekly availability, time-off, and service-area validation during
  assignment. Mapping and travel estimates remain provider-dependent.
- Mobile assigned-job list using the new RLS policies.
- Run the pgTAP suite on Docker/Podman-enabled CI or a development workstation.
- Broader schedule concurrency and state-machine integration tests against a
  disposable PostgreSQL instance.

## Requirement status

- FR-010: Partial — job metrics are live; invoice/revenue metrics depend on
  Phase 3.
- FR-020: Partial — core job fields, filters, detail, assignment, and activity
  are live; quote/invoice/report/media sections depend on later phases.
- FR-021: Delivered for the proposed lifecycle.
- FR-022: Partial — time-slot assignment and conflict-safe writes are live;
  daily/weekly board remains.
- FR-023: Partial — active technician validation is live; skills, time-off, and
  travel checks remain.
- FR-024: Delivered for material job changes in this slice.
- FR-050: Web/RLS foundation only; mobile list remains.
