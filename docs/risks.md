# Active engineering risks

## R-001: Stable Expo toolchain dependency advisories

- Status: Open; blocks deployment and mobile release
- Observed: 2026-10-12
- Scope: Expo SDK 57 / Metro transitive build tooling

`npm audit --omit=dev` reports high-severity advisories in transitive `braces` and `node-forge` packages, plus a moderate `uuid` advisory. npm currently offers only a breaking downgrade to Expo 44, which is not an acceptable remediation. No production mobile build or deployment is authorized while high findings remain.

Mitigation:

1. Keep the production dependency audit as a blocking CI job.
2. Track patched stable Expo/Metro packages and update promptly.
3. Re-run application type checks, native builds, and device smoke tests after upgrading.
4. Do not use `npm audit fix --force` to accept an unreviewed downgrade.

## R-002: Local infrastructure unverified in current workstation

Docker is not installed in the current workspace environment. `compose.yaml` can be reviewed, but PostgreSQL and Redis health checks cannot be exercised here. Validate `docker compose config` and start both health checks on a Docker-enabled development or CI host before Phase 1 migrations.

## R-003: Pending Next.js upstream security update

The Next.js project announced an out-of-band security update for October 14, 2026, concerning upstream dependency vulnerabilities. CrewFlow is not deployed. Re-check the official advisory, upgrade to the patched stable version, and re-run the build and audit before any environment is exposed.
