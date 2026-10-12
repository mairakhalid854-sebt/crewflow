# Phase 0 handoff

- Status: Foundation implemented; application delivery has not started
- Date: 2026-10-12

## Delivered

- npm workspaces for web, API, mobile, worker, and shared packages
- Responsive Next.js dashboard shell using CrewFlow design tokens and clearly labelled synthetic data
- NestJS API with `/v1/health`
- Expo SDK 57 mobile shell with no connected accounts or production data
- Side-effect-free worker boundary
- Strict TypeScript 6, ESLint, Prettier, Vitest, locked dependencies, Dependabot, secret scan, and CI workflow
- Local PostgreSQL 16 and Redis 7 Compose services with health checks
- Environment template with stub providers and no secrets
- Architecture decision, Supabase evaluation, OpenAPI plan, requirement milestones, production decisions, threat model, and active risk register

## Migrations

None. Phase 1 will introduce the first reviewed Prisma migration for identity, tenant, membership, customer, service, and audit foundations. No database structure is represented as implemented yet.

## Verification evidence

| Check                                                          | Result                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `npm run format:check`                                         | Passed                                                                          |
| `npm run lint`                                                 | Passed with zero warnings                                                       |
| Strict TypeScript across API/mobile/web/worker/config/types/UI | Passed                                                                          |
| Vitest                                                         | 3 files, 5 tests passed                                                         |
| NestJS API build                                               | Passed                                                                          |
| Next.js production build                                       | Passed; `/` prerendered statically                                              |
| Worker build                                                   | Passed                                                                          |
| Web local response                                             | HTTP 200 and expected `<title>CrewFlow</title>`                                 |
| API runtime response                                           | HTTP 200 with `{"service":"crewflow-api","status":"ok","version":"v1"}`         |
| Browser visual inspection                                      | Not run; no browser target was available                                        |
| PostgreSQL/Redis runtime health                                | Not run; Docker is not installed on this workstation                            |
| Production dependency audit                                    | Failed: 15 high and 7 moderate findings in stable Expo/Metro transitive tooling |

## Demo instructions

1. Install Docker Desktop or connect development-only PostgreSQL and Redis instances.
2. Copy `.env.example` to `.env`.
3. Run `npm install`.
4. Run `docker compose up -d`.
5. Run `npm run dev:web` and open `http://localhost:3000`.
6. Run `npm run dev:api` and open `http://localhost:3001/v1/health`.
7. Run `npm run dev:mobile` only in an Expo-compatible development environment.

The dashboard is a design/system shell. Buttons and navigation intentionally do not imply implemented business workflows.

## Requirement checkpoint

Phase 0 is an enabler and does not close product requirement IDs. The following foundations are prepared but remain unimplemented until their planned phases:

- FR-001–005: application/API shells and tenant-context contract only; no authentication, membership, or onboarding yet.
- FR-010–012: responsive dashboard and synthetic fixtures only; no persisted aggregates or CRM yet.
- FR-020–024: job/status types only; no approved state machine, scheduling, or audit persistence yet.
- FR-030–044: documented payment separation and provider adapters only; no quote, invoice, payment, or billing flow yet.
- FR-050–056: mobile shell only; no sign-in, jobs, uploads, signatures, or push yet.
- FR-060–070: safety/approval architecture only; no AI operations or external assistant yet.
- FR-080–082: stub email configuration only; no provider or message workflow yet.

## Gate before Phase 1

1. Run Compose and verify both service health checks on a Docker-enabled machine.
2. Perform browser visual and keyboard QA on the dashboard shell.
3. Decide whether Supabase is approved for development/staging; production plan, region, recovery goals, and DPA can remain a later release gate.
4. Keep the Expo dependency advisory as a blocking release risk and upgrade when patched stable packages are available.
5. Confirm the proposed stack direction before committing the Phase 1 schema and authentication provider.
