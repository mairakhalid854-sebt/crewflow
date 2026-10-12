# OpenAPI contract plan

The API contract will be the source of truth for web and mobile clients beginning in Phase 1.

## Conventions

- Base path: `/v1`; public purpose-token routes use `/public` and provider callbacks use `/webhooks`.
- JSON request/response bodies with schema validation at the boundary.
- Stable error envelope: `code`, `message`, optional field `details`, and `correlationId`.
- Cursor pagination for unbounded collections; explicit sort fields and limits.
- Idempotency keys for externally retried commands and side effects.
- Tenant IDs are never accepted as authority-bearing client input.
- UTC ISO-8601 timestamps at the API; integer minor units plus an explicit currency code for money.

## Generation workflow

NestJS will emit an OpenAPI document from validated DTOs. CI will verify that generation is deterministic and will regenerate a typed client in `packages/api-client`. Contract changes require review for authorization scope, backwards compatibility, and accidental disclosure.

## Initial endpoint order

1. Health/readiness and authentication
2. Tenant onboarding and memberships
3. Customers and service catalog
4. Jobs, assignments, status, and schedule
5. Quotes, invoices, payment records, and public purpose-token pages
6. Approvals and agent runs
7. Signed provider webhooks
