# Phase 1 progress: identity and tenancy

Updated: 2026-10-12

Phase 1 has started. This is the first vertical slice, not completion of the full PRD or Phase 1.

## Delivered in this slice

- Supabase CLI project configuration and versioned SQL migration.
- Email/password owner registration, email confirmation callback, login, password reset/update, logout action, and server-side route protection.
- Atomic onboarding RPC that creates a US business tenant, owner membership, settings, default business hours, and initial audit event.
- Tenant-owned tables for memberships, settings, hours, services, customers, and audit events.
- Row-level security policies for owner, office, and technician access; no anonymous tenant-table grants.
- Immutable `tenant_id` triggers and one-active-tenant membership constraint for the v1 account model.
- NestJS tenant-context service that derives tenant scope from membership and rejects cross-tenant resource access.
- Static migration contract tests and tenant-context unit tests.
- Generated TypeScript database types from the hosted schema.
- Transaction-wrapped pgTAP coverage for owner, technician, anonymous, and cross-tenant access paths.
- Authenticated responsive web workspace with tenant-aware navigation and route protection.
- Customer list/search/create/edit/archive flows with address, notes, and email-consent fields.
- Service catalog list/search/create/edit/archive flows with integer-cent pricing, duration, tax behavior, and availability.
- Server actions derive tenant identity from the authenticated membership and scope every resource mutation by tenant.
- Shared loading, error, empty, validation, pending, and destructive-action confirmation states for the new workspace flows.

## Still required for Phase 1

- Run the pgTAP RLS suite on a workstation/CI runner with Docker or Podman. The hosted CLI test path still uses a pgTAP container.
- Member invitation tokens, invitation acceptance, role changes, and immediate deactivation.
- Staff skills, availability, service areas, and team management UI/API.
- Business-hours editor, profile/settings completion, audit viewer, rate limiting, and observability.
- Mobile authentication integration and relevant authorization tests.
- Customer detail jobs, invoices, and lifetime-paid totals remain dependent on Phase 2 and Phase 3 data models.

## Current verification

- Formatting, ESLint, strict TypeScript, 25 unit/contract tests, and all production builds pass.
- The supplied Supabase URL and publishable key are valid; email signup is enabled and email confirmation is required.
- The GitHub remote is connected and its existing initial commit has been preserved as project history.
- The Supabase CLI is authenticated and linked; migration `202610120001` is applied remotely and `supabase db lint --linked` reports no schema errors.
- Anonymous REST access to `tenants` is denied at the grant boundary. Full authenticated pgTAP isolation tests are pending because Docker/Podman is not installed.
- Deployment remains blocked by the Expo transitive high-severity dependency advisories recorded in `docs/risks.md`.

## Configuration needed

Set these non-secret browser values in `.env`:

```dotenv
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Do not share or place the Supabase service-role/secret key in a `NEXT_PUBLIC_*` variable. Hosted email confirmation and password-reset redirect URLs must allow the deployed app callback URL before production use.
