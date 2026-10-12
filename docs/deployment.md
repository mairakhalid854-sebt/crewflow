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

- Web: Vercel project built from the repository root with workspace-aware `vercel.json`; the deployed Next.js app lives in `apps/web` and initially uses a generated `*.vercel.app` hostname.
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
- The repository is linked to Supabase project `mlgfyxsqorualqwbecmp`; migrations `202610120001` and `202610120002` are applied and the hosted schema lint is clean.
- GitHub remote `mairakhalid854-sebt/crewflow` is connected locally.
- Generated database types match the hosted schema. Full pgTAP execution awaits Docker/Podman on a test runner.
- Vercel project `saas-team-crew-flow/crewflow` is linked and the protected Preview deployment at `https://crewflow-kn03f04wn-saas-team-crew-flow.vercel.app` builds successfully.
- Preview Supabase public variables are configured in Vercel. Supabase Auth allows localhost and the Vercel team preview-host pattern; undeclared hosted Auth/MFA/pooler settings were left unchanged.
- Vercel's GitHub App is connected to `mairakhalid854-sebt/crewflow`. Ongoing work is pushed to the `staging` branch for protected Preview deployments; `main` is reserved for reviewed production promotion.
- A custom domain is optional for staging; the generated Vercel hostname is sufficient.
