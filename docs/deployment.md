# Deployment runbook

CrewFlow deploys components independently. A component is promoted only after its scoped security and isolation gates pass.

## Environments

| Environment | Purpose                                                     | Data rule                              |
| ----------- | ----------------------------------------------------------- | -------------------------------------- |
| Local       | Development and destructive reset tests                     | Synthetic data only                    |
| Staging     | Auth, migration, RLS, and browser/device acceptance testing | Synthetic data only                    |
| Production  | Approved customer traffic                                   | Production retention and backup policy |

Supabase staging and production must be separate projects before real customer data is accepted. The currently supplied project is treated as development/staging until the owner explicitly promotes it.

## Component targets

- Web: Vercel project rooted at `apps/web`, initially using its generated `*.vercel.app` hostname.
- Identity/database: Supabase, deployed only from committed files under `supabase/migrations`.
- API and worker: Railway services after their Phase 1/2 runtime responsibilities exist. They are not deployable product services yet.
- Mobile: Expo EAS internal builds first; store submission remains blocked until mobile security advisories and store prerequisites are cleared.

## Staging sequence

1. Run the repository quality gate and the deployable-workspace production audit.
2. Authenticate the Supabase CLI locally without committing the access token.
3. Link the repository to the staging project and run `supabase db push`.
4. Generate database types from the applied schema and commit them.
5. Execute authenticated cross-tenant RLS tests against staging.
6. Connect the GitHub repository to Vercel with `apps/web` as the project root.
7. Set Vercel preview/production environment variables from `apps/web/.env.example`.
8. Deploy a preview, then add its HTTPS callback URL to Supabase Auth URL Configuration.
9. Test signup, email confirmation, reset, onboarding, logout, and unauthorized tenant access.
10. Promote the same reviewed commit to production only after all release blockers are closed.

## Secrets

The Supabase access token, database password, service-role key, SMTP credentials, Vercel token, and future provider keys belong only in the relevant platform secret store. They must never be pasted into source files, `NEXT_PUBLIC_*` variables, build logs, or Git history.

## Current external state

- Supabase project URL and publishable key respond successfully; email signup is enabled and email confirmation is required.
- GitHub remote `mairakhalid854-sebt/crewflow` is connected locally.
- Supabase CLI authentication and database migration push are pending.
- Vercel project creation/linking and preview deployment are pending.
- A custom domain is optional for staging; the generated Vercel hostname is sufficient.
