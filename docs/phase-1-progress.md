# Phase 1 progress: identity and tenancy

Updated: 2026-10-12

Phase 1 is actively in development. Identity, tenancy, customer/service setup,
and the team-management foundation are implemented; the remaining acceptance
gates below still prevent calling the full PRD or Phase 1 complete.

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
- US-only country, dependent state, and state-filtered city selection for company onboarding and customer addresses.
- Owner-created 72-hour invitation links whose raw tokens are returned once and stored only as SHA-256 hashes.
- Invite-aware signup/login/email-confirmation flow and verified-email invitation acceptance.
- Owner-only role changes, invitation revocation, last-owner protection, and immediate membership deactivation.
- Staff profiles with skills, service-area ZIP codes, weekly availability, retained history, and Owner/Office editing UI.
- Audit triggers for Customer and Service changes plus a tenant-scoped audit viewer for Owner/Office roles.
- Owner-only company settings for business identity, dependent US state/city address, service categories, tax, notifications, and opt-in AI budget policy.
- Transactional seven-day business-hours editor with server/database validation and a settings audit event.
- Strict owner-only database policy for company business-hours changes.
- Self-service personal profile editing for every active role, synchronized to authentication metadata and staff directory names.

## Still required for Phase 1

- Run the pgTAP RLS suite on a workstation/CI runner with Docker or Podman. The hosted CLI test path still uses a pgTAP container.
- Transactional email delivery for invitation links; links are currently copied by the owner and sent privately until an email provider is configured.
- Rate limiting and observability.
- Mobile authentication integration and relevant authorization tests.
- Customer detail jobs, invoices, and lifetime-paid totals remain dependent on Phase 2 and Phase 3 data models.

## Current verification

- Formatting, ESLint, strict TypeScript, 44 unit/contract tests, and all production builds pass.
- The supplied Supabase URL and publishable key are valid; email signup is enabled and email confirmation is required.
- The GitHub remote is connected and its existing initial commit has been preserved as project history.
- The Supabase CLI is authenticated and linked; migrations through `202610130002` are applied remotely and `supabase db lint --linked` reports no schema errors.
- Anonymous REST access to `tenants` is denied at the grant boundary. Full authenticated pgTAP isolation tests are pending because Docker/Podman is not installed.
- A protected Vercel Preview build is live and passes authenticated smoke requests; Supabase Auth permits the Vercel team preview-host pattern.
- Vercel's GitHub App is connected; the `staging` branch is used to verify automatic protected Preview deployments without prematurely promoting `main` to production.
- Production promotion and mobile release remain blocked by the acceptance gaps and Expo transitive high-severity dependency advisories recorded in `docs/risks.md`.

## Configuration needed

Set these non-secret browser values in `.env`:

```dotenv
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Do not share or place the Supabase service-role/secret key in a `NEXT_PUBLIC_*` variable. Hosted email confirmation and password-reset redirect URLs must allow the deployed app callback URL before production use.
