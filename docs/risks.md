# Active engineering risks

## R-001: Stable Expo toolchain dependency advisories

- Status: Open; one reviewed low-severity build-time advisory remains
- Observed: 2026-10-12
- Scope: Expo SDK 57 / Metro transitive build tooling

The 2026-10-27 review upgraded transitive `node-forge` from 1.4.0 to its compatible patched 1.4.1 release. `npm audit --omit=dev --workspace @crewflow/mobile` now reports one underlying high-severity advisory in transitive `zod` 3.25.76 through `@expo/cli` 57.0.32. Expo 57.0.31 is the latest SDK 57 release and its CLI requires `zod ^3.25.76`; npm's suggested remediation is a breaking downgrade to Expo 54, which is not acceptable. The vulnerable code is in the native build CLI rather than the shipped web, API, or worker services. No production mobile build or deployment is authorized while this high finding remains.

The 2026-10-28 review removed the `zod` finding without changing Expo: a scoped npm override gives `@expo/cli` the patched `zod` 4.6.7 (GHSA-mrhx-c7xc-m3w5 is fixed only in 4.6.6+). No Expo release, including SDK 58 and canary, has moved off `zod` 3, and 3.x has no patch. The CLI uses `zod` only for DevTools plugin and optional MCP extension schemas (`object`, `string`, `enum`, `array`, `union`, `literal`, `strict`, `safeParse`, `error.issues`), all present in v4; those schemas, `expo config`, and a full `expo export --platform android` were verified under 4.6.7. Remove the override once Expo depends on a patched `zod` directly.

The same review added low-severity GHSA-gcqx-w48m-w2h4 (prototype poisoning in `deepmerge` `mergeObject()`), reached only through `@expo/config` 57.0.10, Expo's build-time configuration loader. `deepmerge` 4.3.1 is the latest release and is affected, so no compatible patch exists; npm again proposes the breaking Expo 54 downgrade. It carries the same 2026-11-10 review date.

The 2026-11-02 review added moderate GHSA-3g3m-2fjr-6pw4 (`glob` AbortSignal cancellation bypass that lets a timed-out traversal keep reading the filesystem), reached only through `glob` 13.0.6 in Expo's build-time CLI and config packages. The app bundle does not ship `glob`, and Expo never relies on aborting a glob for a security boundary. The patch is only in `glob` 14.0.2, a major release Expo has not adopted, and npm again proposes the breaking Expo 51 downgrade. It carries the same 2026-11-10 review date.

The same review added moderate GHSA-g3hv-75wg-m249 (`minimatch` denial of service through brace/globstar pattern amplification), reached only through `glob` and `@expo/fingerprint`, both build-time Expo tooling. The patterns they expand come from Expo and the repository, never from app users, so the app has no attacker-controlled input path. The fix is only in `minimatch` 11.0.1, a major release Expo has not adopted. It carries the same 2026-11-10 review date.

Mitigation:

1. Keep a strict blocking audit for the deployable web, API, and worker workspaces.
2. Monitor the exact remaining mobile advisory in CI with package, severity, and advisory-source validation; any new advisory or metadata change fails CI.
3. Expire the renewed temporary review on 2026-11-10 so CI cannot silently carry the exception indefinitely.
4. Track patched stable Expo/Metro packages and update promptly.
5. Re-run application type checks, native builds, and device smoke tests after upgrading.
6. Do not use `npm audit fix --force` to accept an unreviewed downgrade.

## R-002: Local infrastructure validation depends on CI

Docker is not installed in the current workstation environment, so local PostgreSQL and Redis health checks cannot run here. The GitHub database-integration job now provisions Supabase and repeatedly passes the pgTAP/database suite for staging pull requests and post-merge commits. Keep that CI job required, and run the provider backup/restore drill against a separate production-like environment before launch.

## R-003: Web dependency security monitoring

The web app has been upgraded to Next.js 16.4.3. On 2026-10-27, `npm run audit:production` reported zero known production vulnerabilities across the web, API, and worker workspaces. Keep the production audit required in CI and re-run it immediately before promotion because this status can change as advisories are published.
