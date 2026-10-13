# Active engineering risks

## R-001: Stable Expo toolchain dependency advisories

- Status: Open; blocks mobile deployment and release
- Observed: 2026-10-12
- Scope: Expo SDK 57 / Metro transitive build tooling

`npm audit --omit=dev --workspace @crewflow/mobile` reports high-severity advisories in transitive `braces` and `node-forge` packages, plus a moderate `uuid` advisory. npm currently offers only a breaking downgrade to Expo 44, which is not an acceptable remediation. These packages belong to the Expo/Metro native build toolchain and are not included in the deployed web, API, or worker services. No production mobile build or deployment is authorized while high findings remain.

Mitigation:

1. Keep a strict blocking audit for the deployable web, API, and worker workspaces.
2. Monitor the three exact mobile advisories in CI with package, severity, and advisory-source validation; any new advisory or metadata change fails CI.
3. Expire the temporary review on 2026-10-27 so CI cannot silently carry the exception indefinitely.
4. Track patched stable Expo/Metro packages and update promptly.
5. Re-run application type checks, native builds, and device smoke tests after upgrading.
6. Do not use `npm audit fix --force` to accept an unreviewed downgrade.

## R-002: Local infrastructure unverified in current workstation

Docker is not installed in the current workspace environment. `compose.yaml` can be reviewed, but PostgreSQL and Redis health checks cannot be exercised here. Validate `docker compose config` and start both health checks on a Docker-enabled development or CI host before Phase 1 migrations.

## R-003: Pending Next.js upstream security update

The Next.js project announced an out-of-band security update for October 14, 2026, concerning upstream dependency vulnerabilities. CrewFlow is not deployed. Re-check the official advisory, upgrade to the patched stable version, and re-run the build and audit before any environment is exposed.
