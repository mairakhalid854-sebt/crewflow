# CrewFlow

CrewFlow is a multi-tenant field-service-management platform for US home-service businesses. The repository contains the Phase 0 foundation and the first Phase 1 identity/tenancy slice described in `CrewFlow_PRD.md`; it is not production-ready.

## Prerequisites

- Node.js 22 or newer (Node 24 is used in the current workspace)
- npm 11 or newer
- Docker Desktop or compatible Docker Engine (required for the local Supabase stack; not available in the current workspace)

## Local setup

1. Copy `apps/web/.env.example` to `apps/web/.env.local` and set the Supabase project URL and publishable key. Keep root `.env.example` as the reference for API/worker infrastructure.
2. Run `npm install`.
3. With Docker running, run `npm run supabase:start` and then `npm run supabase:reset` to apply migrations.
4. Run `docker compose up -d redis` for the queue dependency.
5. Run `npm run dev:web` and `npm run dev:api` in separate terminals.
6. Open `/signup` to exercise registration, verification, login, and company onboarding.
7. For mobile development, create `apps/mobile/.env.local` with the two
   `EXPO_PUBLIC_SUPABASE_*` values shown in `.env.example`. Then run
   `npm run dev:mobile` after installing Expo Go or configuring a simulator.

The web app runs at `http://localhost:3000`; the API defaults to `http://localhost:3001/v1/health`.

## Quality gates

Run the full local gate with:

```sh
npm run check
```

This checks formatting, lint rules, strict TypeScript, unit tests, and builds. The CI workflow repeats these gates. Docker services are required once database integration tests are introduced in Phase 1.

## Contribution workflow

Every feature or fix must use a short-lived branch and a meaningful
Conventional Commit. Pull requests merge into `staging`; production promotion
is a separate `staging` to `main` pull request. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the required branch, commit, test, and
deployment flow.

## Current scope

- Architectural decisions and phased requirement mapping
- Next.js, NestJS, Expo, and worker application shells
- Supabase email/password authentication with confirmation, login, reset, logout server actions, and protected routes
- Expo mobile email/password sign-in with encrypted session persistence and active-membership authorization
- Atomic company onboarding and owner membership creation
- PostgreSQL tenant schema, role-based RLS policies, immutable tenant ownership, and audit foundation
- NestJS tenant-context guard service with fail-closed isolation tests
- Shared TypeScript types, configuration parsing, and UI design tokens
- Local PostgreSQL/Redis Compose services
- CI, formatting, linting, strict type checking, tests, and secret scanning
- Initial threat model and OpenAPI contract plan

No live payment provider, email provider, AI provider, cloud storage, deployment, or mobile publishing is configured.

## Documentation

- [`docs/architecture/0001-platform-foundation.md`](docs/architecture/0001-platform-foundation.md)
- [`docs/architecture/supabase-evaluation.md`](docs/architecture/supabase-evaluation.md)
- [`docs/security/threat-model.md`](docs/security/threat-model.md)
- [`docs/milestones.md`](docs/milestones.md)
- [`docs/openapi.md`](docs/openapi.md)
- [`docs/phase-0-handoff.md`](docs/phase-0-handoff.md)
- [`docs/phase-1-progress.md`](docs/phase-1-progress.md)
- [`docs/production-blockers.md`](docs/production-blockers.md)
- [`docs/deployment.md`](docs/deployment.md)
- [`docs/risks.md`](docs/risks.md)
