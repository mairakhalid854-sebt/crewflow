# Backup and restore runbook

This runbook covers CrewFlow database and private Storage recovery. A production
backup is not considered usable until it has been restored into an isolated
target and the verification checklist below has passed.

## Non-negotiable boundaries

- Never test a restore against the source project or an environment containing
  the only copy of customer data.
- Keep staging and production in separate Supabase projects, organizations or
  access scopes, credentials, buckets, webhooks, cron secrets, and AI/payment
  integrations.
- Do not paste database URLs, access tokens, service-role keys, backup files, or
  customer data into chat, tickets, source control, command history, or CI logs.
- Restore targets start with outbound email, push, Paddle, OpenAI, malware
  scanning, database webhooks, and application cron delivery disabled. A
  restored queue must not contact customers or providers during a drill.
- Preserve immutable audit, payment, consent, signature, and AI trace records.
  Use a reviewed compensating migration; never edit an applied migration.

## Backup coverage

Supabase documents that paid projects receive managed daily database backups,
with retention depending on plan. Point-in-Time Recovery is a separate paid
option. Free projects should be exported regularly with `supabase db dump` and
kept off-provider. The production owner must record the chosen plan, retention,
Recovery Point Objective (RPO), and Recovery Time Objective (RTO) before launch.

Database backups include Storage metadata but not the stored objects themselves.
CrewFlow therefore requires two independently protected artifacts:

1. A managed restore point plus an encrypted off-provider logical database
   export.
2. A private export of every Storage bucket and an inventory containing bucket,
   object key, byte length, content type, and a SHA-256 digest where available.

Use Supabase's current [database backup guidance](https://supabase.com/docs/guides/platform/backups)
and [Storage object download guidance](https://supabase.com/docs/guides/storage/management/download-objects)
when configuring the operator procedure. Storage may be copied with the
Supabase CLI or its S3-compatible endpoint; credentials belong only in the
operator's secret manager.

## Backup procedure

1. Confirm the source project reference and environment twice. Record UTC start
   time, source database version, deployed Git SHA, latest migration filename,
   and the most recent successful provider backup time.
2. Export the logical database with the current Supabase CLI `db dump` command
   or `pg_dump` version compatible with the source PostgreSQL version. Direct
   output to an encrypted, access-controlled temporary location.
3. Export all private Storage objects and an inventory. Do not rely on database
   metadata as proof that object bytes were backed up.
4. Generate SHA-256 digests for the database artifact, Storage inventory, and
   object archive or per-object entries. Record sizes and completion time.
5. Copy artifacts to the approved off-provider encrypted destination, verify
   the copied digests, apply retention/immutability controls, and remove local
   temporary copies through the approved secure-deletion process.
6. Record success or failure without including database URLs, object names that
   contain customer data, tokens, or raw records.

## Isolated restore drill

1. Create an empty, non-production target in the same region and compatible
   PostgreSQL version. The target must use synthetic outbound credentials or no
   outbound credentials at all.
2. Disable or remove copied cron jobs, database webhooks, replication slots,
   and provider integrations before allowing the restored target network access.
   Supabase specifically recommends inspecting those definitions when a restore
   must not trigger external work.
3. Restore the logical database or use Supabase's paid restore-to-new-project
   workflow. Never restore over the source for a drill.
4. Restore Storage object bytes into private buckets, preserving exact keys.
   Compare the restored inventory and digests with the backup evidence.
5. Apply only reviewed migrations newer than the restore point, in order. Regenerate
   database types and compare them with the tested application commit.
6. Use synthetic operator accounts to execute the verification checklist. Do
   not enable real email, push, Paddle, OpenAI, or customer-facing domains.
7. Destroy the isolated target only after the drill record and sanitized
   evidence have been reviewed and retained. Confirm deletion through the
   provider dashboard; deleting a project also removes its provider-held
   backups.

## Verification checklist

- Database version, extension set, migration history, functions, triggers,
  RLS-enabled tables, grants, cron definitions, and generated types match the
  expected commit.
- Foreign-key checks and the full pgTAP/database integration suite pass.
- Per-table and per-tenant aggregate row counts reconcile without exporting raw
  customer rows into the drill record.
- Auth sign-in, invitation, password recovery, and membership revocation work
  with synthetic accounts.
- Cross-tenant reads and writes remain denied.
- Private job photos, signatures, generated documents, and knowledge uploads
  exist at their referenced keys and require authorization.
- Job, quote, report, invoice, payment-state, subscription-entitlement, AI
  approval, and audit histories are internally consistent.
- Push, Follow-Up, billing reconciliation, AI provider-review, and knowledge
  queues can be inspected and replayed idempotently with outbound calls still
  disabled.
- Public token links remain purpose-bound and unauthorized `/app` access still
  redirects to login.
- The web smoke check passes against the isolated application deployment.
- Actual restore duration and maximum observed data age satisfy the approved
  RTO and RPO.

## Drill evidence

Record the drill date, participants, source restore-point timestamp, isolated
target identifier, backup and Storage inventory digests, Git SHA, migration
version, start/end times, RPO/RTO result, checklist result, defects, corrective
owners, and target deletion confirmation. Keep evidence redacted and access
controlled. A successful schema reset in CI is useful migration evidence but is
not a substitute for restoring real backup artifacts and Storage bytes.

## Emergency production restore

Declare a SEV-1 incident and follow `docs/incident-response.md`. Choose the
closest verified restore point before the incident, announce expected downtime,
and preserve current evidence before restoration. Supabase documents that an
in-place restore makes the project unavailable during the operation and that
custom-role passwords, subscriptions, or replication slots may require manual
reconfiguration. Reconcile Paddle state and all idempotent queues before
restoring write access or outbound delivery.
