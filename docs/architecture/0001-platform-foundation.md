# ADR 0001: Platform foundation

- Status: Accepted for Phase 0
- Date: 2026-10-12
- Decision owners: Product owner and engineering

## Context

CrewFlow must support a tenant-isolated web application, iOS/Android clients, asynchronous work, and later AI-assisted workflows without making AI or a third-party provider necessary for core operations. The starting repository contained only the PRD.

## Decision

Start with a TypeScript modular monolith and explicit boundaries:

- `apps/web`: Next.js App Router for marketing, authentication, and owner/office workflows.
- `apps/api`: NestJS REST API. Controllers validate transport input; domain services own commands and authorization decisions.
- `apps/mobile`: Expo/React Native shell for technician and later owner workflows.
- `apps/worker`: asynchronous process boundary for outbox, email, reminders, and later agent work.
- `packages/types`: transport-safe enums and interfaces with no server secrets.
- `packages/config`: fail-fast environment parsing that does not expose server values to clients.
- `packages/ui`: shared design tokens; platform components remain in their application until reuse is proven.
- `packages/database`: database contract checks around versioned Supabase SQL migrations beginning in Phase 1.

Use Supabase PostgreSQL as the system of record and Supabase Auth for identity. Supabase CLI SQL migrations are the only schema-migration source; do not maintain a parallel Prisma migration history. Row-level security protects browser-accessible data, while NestJS domain services remain an additional authorization boundary for privileged workflows. Redis remains the planned queue backend. Prefer a transactional outbox for external effects. Generate clients from a versioned OpenAPI document after API contracts are introduced.

Do not extract a Python AI service until a concrete orchestration requirement justifies the operational cost. AI calls will use narrow server-side tools and will never receive unrestricted database credentials.

## Tenant and authorization invariant

Every tenant-owned row will include `tenant_id`. The authenticated membership establishes tenant context; API input must never choose it. Repository methods must require a tenant context and include it in every predicate. PostgreSQL row-level security is planned as defense in depth, not a substitute for application authorization. Technician reads require both tenant membership and job relevance/assignment.

Cross-tenant read/write tests are a release blocker beginning in Phase 1.

## Payment boundaries

Two financial domains remain deliberately separate:

1. CrewFlow subscription billing charges the subscribing business through a future adapter. Paddle is only a proposed provider and stays in stub/sandbox mode until eligibility and commercial configuration are approved.
2. Service revenue belongs to the subscribing business. CrewFlow may show its external payment URL or record an authorized manual/provider-confirmed ledger event, but it does not collect, custody, split, route, or infer receipt of those funds.

Following an external link can never mark an invoice paid. Client redirects can never grant subscription entitlement; only verified, idempotent server events may do so.

## Initial assumptions

- One user belongs to one business in v1.
- USD and US address/phone conventions are the initial product scope.
- Timestamps are stored in UTC and presented in the tenant's IANA time zone.
- Provider integrations are adapters with local stubs until explicitly selected.
- The proposed job state machine remains configuration/design input until approved before Phase 2.
- Phase 0 contains representative fixtures and UI shells. Phase 1 connects authentication and persistence after a Supabase environment is configured.

## Consequences

The modular monolith minimizes early operational burden while preserving extraction points. The separate worker prevents long-running email, document, notification, and AI tasks from blocking API requests. Shared packages are intentionally small to avoid leaking privileged server code into client bundles.
