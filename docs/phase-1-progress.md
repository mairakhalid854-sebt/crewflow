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

## Still required for Phase 1

- Configure a real development Supabase project or run the local stack with Docker, then execute the migration and end-to-end RLS isolation tests against PostgreSQL.
- Generate committed Supabase TypeScript database types from the verified schema.
- Member invitation tokens, invitation acceptance, role changes, and immediate deactivation.
- Staff skills, availability, service areas, and team management UI/API.
- Customer and service CRUD/search UI/API, including empty/loading/error states.
- Business-hours editor, profile/settings completion, audit viewer, rate limiting, and observability.
- Mobile authentication integration and relevant authorization tests.

## Current verification

- Formatting, ESLint, strict TypeScript, unit/contract tests, and production builds pass.
- The supplied Supabase URL and publishable key are valid; email signup is enabled and email confirmation is required.
- The GitHub remote is connected and its existing initial commit has been preserved as project history.
- Database runtime/RLS tests are pending because Docker is not installed and the Supabase CLI is not yet authenticated/linked to the hosted project.
- Deployment remains blocked by the Expo transitive high-severity dependency advisories recorded in `docs/risks.md`.

## Configuration needed

Set these non-secret browser values in `.env`:

```dotenv
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Do not share or place the Supabase service-role/secret key in a `NEXT_PUBLIC_*` variable. Hosted email confirmation and password-reset redirect URLs must allow the deployed app callback URL before production use.
