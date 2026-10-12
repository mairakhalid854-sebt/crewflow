# Delivery milestones and requirement map

Each phase must pass its own acceptance criteria before the next begins.

| Phase                       | Scope                                                                                                            | Requirement IDs                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 0 — Foundation              | ADR, monorepo, quality gates, local services, environment contract, tokens, fixtures, OpenAPI plan, threat model | Enablers for all requirements                   |
| 1 — Identity and tenancy    | Auth, onboarding, memberships/RBAC, customers, services, staff, audit foundation                                 | FR-001–005, FR-011–012, tenant parts of FR-024  |
| 2 — Jobs and scheduling     | Jobs, state machine, assignments, conflict prevention, dashboard, mobile assigned list                           | FR-010, FR-020–024, read-only slice of FR-050   |
| 3 — Quotes and invoices     | Public quote decisions, reports, invoices, external links, manual payment ledger, email                          | FR-030–036, FR-080–082                          |
| 4 — Field mobile            | Status execution, photos, notes, signatures, push, owner approvals views                                         | FR-050–056                                      |
| 5 — SaaS billing            | Stub/sandbox provider, verified webhooks, entitlement and reconciliation                                         | FR-040–044                                      |
| 6 — AI platform             | Approval engine, budgets, knowledge base, traces/evals; ship agents one at a time                                | FR-060–068                                      |
| 7 — Hardening and expansion | Read-only assistant, reporting, accessibility, resilience, release readiness                                     | FR-070, FR-081 plus cross-cutting quality gates |

Cross-cutting security, accessibility, observability, performance, and tenant-isolation criteria apply in every phase rather than being deferred to Phase 7.
