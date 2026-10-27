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

The native app owns the `crewflow` URL scheme with Android package and iOS bundle identifier `com.crewflow.mobile`. Supabase Auth must allow the exact `crewflow://auth/reset` redirect before testing password recovery in an installed development or internal build. Expo Go does not provide a stable custom-scheme callback and is not the acceptance-test target for this flow.

## Runtime guardrails

- Supabase Auth enforces its configured sign-in, token, and email rate limits before the application receives an authenticated session.
- Every NestJS API route has a default process-local limit of 120 requests per 60 seconds. `API_RATE_LIMIT_MAX` and `API_RATE_LIMIT_WINDOW_MS` accept bounded integer overrides and fail startup on unsafe values.
- API responses carry `x-correlation-id`. Only UUID-shaped incoming values are preserved; other values are replaced. Completion logs contain the correlation ID, method, path without query data, status, and duration—never cookies, request bodies, query values, or customer identifiers.
- Production API logs are newline-delimited JSON on stdout for a hosting log drain. Before more than one API replica or public traffic, configure a shared Redis limiter or provider WAF and a centralized log/alert destination; process-local counters do not coordinate across replicas.

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
10. Build the mobile development/internal client and smoke-test `crewflow://auth/reset` on a physical device.
11. For Phase 5 sandbox billing, set `PADDLE_SANDBOX_WEBHOOK_SECRET` only in Supabase Secrets, deploy `paddle-billing-webhook`, and configure a Paddle sandbox notification destination to its HTTPS function URL.
12. Create a least-privilege sandbox API key with `subscription.read` and `customer_portal_session.write`, store it only as the Supabase secret `PADDLE_SANDBOX_API_KEY`, then deploy `reconcile-paddle-billing` and `create-paddle-portal-session`.
13. Replay signed, duplicate, out-of-order, pause, cancellation, recovery, reconciliation, and owner portal simulations before calling `configure_paddle_reconciliation_cron()` or enabling any checkout UI.
14. For the Dispatcher staging model review, store `CREWFLOW_AI_PROVIDER_API_KEY`
    only in Supabase Secrets, push the reviewed migration, deploy
    `dispatcher-openai-proposal`, and verify both provider-reviewed and
    credential-absent safe-fallback paths. Never expose this key to the browser.
15. Promote the same reviewed commit to production only after all release blockers are closed.

## Web smoke check

Run the deployment smoke check against an HTTPS environment after its deploy
finishes:

```powershell
npm.cmd run smoke:web -- https://your-environment.example
```

For a protected Vercel preview, place its automation bypass secret only in the
current PowerShell process and then run the same command. Do not paste the
secret into chat, source files, command history, or CI logs.

The check verifies public login/privacy availability, the non-cacheable web
health endpoint, required security headers, and rejection of unauthenticated
workspace access. A successful smoke check is evidence for that exact URL and
commit only; it is not a substitute for database, mobile, billing, email, or
tenant-isolation acceptance.

## Secrets

The Supabase access token, database password, service-role key, Paddle webhook/API credentials, SMTP credentials, Vercel token, and AI provider keys belong only in the relevant platform secret store. They must never be pasted into source files, `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*` variables, build logs, or Git history. A Vercel secret is not automatically available to a Supabase Edge Function; configure each runtime independently.

## Current external state

- Supabase project URL and publishable key respond successfully; email signup is enabled and email confirmation is required.
- The repository is linked to Supabase project `mlgfyxsqorualqwbecmp`; committed migrations are promoted through the CLI and the hosted schema lint is checked after each push.
- The sandbox reconciliation and customer-portal functions are deployed. The least-privilege sandbox API key is stored in Supabase Secrets, and the hourly reconciliation cron is active at minute 17. Hosted verification on October 22, 2026 showed five consecutive successful runs against the linked sandbox subscription with zero failures.
- GitHub remote `mairakhalid854-sebt/crewflow` is connected locally.
- Generated database types match the hosted schema. Full pgTAP execution awaits Docker/Podman on a test runner.
- Vercel project `saas-team-crew-flow/crewflow` is linked and the protected Preview alias at `https://crewflow-git-staging-saas-team-crew-flow.vercel.app` builds successfully from `staging`.
- Preview Supabase public variables are configured in Vercel. Supabase Auth allows localhost, the Vercel team preview-host pattern, and the exact `crewflow://auth/reset` mobile recovery callback; undeclared hosted Auth/MFA/pooler settings were left unchanged.
- Vercel's GitHub App is connected to `mairakhalid854-sebt/crewflow`. Ongoing work is pushed to the `staging` branch for protected Preview deployments; `main` is reserved for reviewed production promotion.
- A custom domain is optional for staging; the generated Vercel hostname is sufficient.
