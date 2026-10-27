# Incident response runbook

This runbook is the minimum CrewFlow production-response contract. It does not
authorize production launch by itself; alert destinations, named responders,
provider access, and a completed drill are still required.

## Severity

| Severity | Examples                                                                                                             | Initial response target                             |
| -------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| SEV-1    | Cross-tenant exposure, stolen production secret, destructive data loss, widespread authentication or billing failure | Acknowledge immediately; contain before restoration |
| SEV-2    | One tenant cannot operate, queued jobs repeatedly fail, materially incorrect entitlement or customer delivery state  | Acknowledge within 30 minutes                       |
| SEV-3    | Degraded non-critical feature, isolated retryable provider failure, cosmetic defect with a workaround                | Triage within one business day                      |

Targets are internal operating goals until staffing and support coverage are
approved. Never advertise them as a customer SLA without a business decision.

## Required alert sources

- Vercel deployment failures, server error rate, and `/api/health` uptime.
- Supabase database availability, Auth anomalies, storage failures, and backup
  status.
- Failed or growing push, billing reconciliation, Follow-Up, and knowledge
  processing queues.
- Paddle webhook signature/retry failures and entitlement drift.
- OpenAI budget exhaustion, repeated provider fallback, and rejected output
  spikes.
- GitHub production audit, secret scan, database integration, accessibility,
  and performance gate failures.

Route alerts to an approved shared destination with at least two owner/admin
responders. Personal inbox-only alerting is not sufficient for production.

## Response sequence

1. Open an incident record with UTC start time, reporter, severity, affected
   environment, and a correlation ID or provider event ID. Do not paste customer
   data, tokens, request bodies, raw prompts, signatures, or credentials.
2. Confirm impact from provider dashboards and redacted structured logs. Treat
   a suspected cross-tenant read or secret exposure as SEV-1 even if scope is
   uncertain.
3. Contain the issue. Valid actions include disabling the affected cron or Edge
   Function, turning off AI operations, disabling Intake, revoking a provider
   key, pausing a deployment, or restoring read-only subscription access.
4. Preserve evidence before changing state: deployment SHA, migration version,
   queue counts, sanitized log event IDs, audit-event IDs, provider delivery
   IDs, and exact UTC timestamps.
5. Recover through a reviewed rollback or compensating migration. Never rewrite
   an applied production migration or delete immutable audit, AI trace, payment,
   signature, or customer-consent evidence.
6. Verify tenant isolation, authentication, core job operations, queue recovery,
   billing entitlement, and public token pages before closing containment.
7. Record resolution time, customer/legal notification decision, remaining
   risk, and an owner with a due date for every corrective action.

## Credential or tenant-isolation incident

Immediately disable the affected entry point, rotate the credential in its
own provider secret store, revoke active sessions when relevant, and inspect
tenant-scoped audit evidence. Do not reuse a Vercel secret in Supabase or expose
service-role, Paddle, email, malware-scanner, or OpenAI keys to browser/mobile
variables. Qualified legal review decides notification duties and timing.

## Recovery verification

- Run the production web smoke check against the recovered commit.
- Confirm database migration and generated-type versions match the commit.
- Confirm queue leases expire or are safely replayed without duplicate side
  effects.
- Reconcile Paddle subscription state before restoring write access.
- For a database recovery, restore into an isolated target first and compare
  tenant counts, foreign-key integrity, RLS policies, storage references, and
  immutable audit continuity before any cutover.

## Drill gate

Before launch, run one tabletop SEV-1 tenant-isolation scenario and one
production-like restore/queue-replay scenario. Record participants, timestamps,
detection source, containment steps, recovery evidence, gaps, and follow-up
owners. A written runbook without those drill records does not satisfy the
Phase 7 acceptance gate.
