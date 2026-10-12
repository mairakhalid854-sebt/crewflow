# Supabase provider evaluation

- Status: Recommended managed provider for staging/production; not yet connected
- Date: 2026-10-12

## Recommendation

Use Supabase as the initial managed PostgreSQL, identity, and private object-storage provider, subject to owner approval of pricing and data-processing terms. Keep local development on standard PostgreSQL and keep business authorization in the NestJS API.

This is a provider choice, not a change to the core architecture:

- Prisma migrations target ordinary PostgreSQL.
- Supabase Auth establishes identity; NestJS validates the token and then resolves tenant membership and role.
- Application commands pass through NestJS. Browser/mobile clients do not receive privileged database or service-role credentials.
- PostgreSQL RLS repeats tenant boundaries as defense in depth.
- Supabase Storage buckets remain private; the API issues short-lived access only after authorization.
- Redis/queues remain separately managed because Supabase Postgres is not a BullMQ replacement.

## Why it fits

Supabase removes day-to-day database operating-system, backup, and observability work while preserving PostgreSQL portability. It has US deployment regions, paid-plan daily backups, optional point-in-time recovery, Auth, storage, connection pooling, and standard database tooling.

## Reliability boundaries

Supabase does not make application reliability automatic. CrewFlow still owns schema design, RLS policies, application authorization, indexes, connection sizing, query performance, migrations, restore drills, monitoring, and third-party failure handling. Production and staging must use separate projects. The free tier is not suitable for a production promise because inactive projects can be paused and downloadable backups are limited.

Before production data:

1. Select a paid plan and exact US region.
2. Define recovery point/recovery time objectives; enable PITR if daily recovery is insufficient.
3. Maintain tested off-provider logical exports in addition to provider backups.
4. Apply network restrictions and least-privilege dashboard access.
5. Run restore, load, connection-pool, RLS, and cross-tenant tests.
6. Review the current production checklist, shared-responsibility terms, DPA, and pricing.

## Primary references

- https://supabase.com/docs/guides/deployment/shared-responsibility-model
- https://supabase.com/docs/guides/deployment/going-into-prod
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/platform/regions
