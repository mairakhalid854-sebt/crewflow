# Initial threat model

This document is a Phase 0 baseline, not a certification or completed security review.

## Assets and trust boundaries

Protected assets include tenant customer data, schedules, quotes/invoices, uploaded media, signatures, credentials, provider secrets, audit evidence, AI traces, and subscription entitlements. Trust boundaries exist between browsers/mobile clients and the API, tenant contexts, API and database/Redis/storage, background workers, public purpose-token pages, and every third-party provider.

## Priority threats and controls

| Threat                             | Initial control                                                                         | Verification gate                             |
| ---------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------- |
| Cross-tenant object access         | Server-derived tenant context; tenant predicate in repositories; RLS defense in depth   | Negative integration tests for every resource |
| Technician privilege escalation    | Membership role plus job assignment/relevance checks                                    | API authorization matrix tests                |
| Client-supplied tenant spoofing    | Reject/ignore tenant authority in payloads and headers                                  | Contract and integration tests                |
| Session theft or reset replay      | HttpOnly/Secure/SameSite cookies, rotation/revocation, expiring single-use reset tokens | Auth integration tests                        |
| Public token guessing/leakage      | High-entropy hashed purpose tokens, expiry, revocation, throttling, no indexing         | Duplicate/expired/invalid token tests         |
| Double booking and stale approvals | Transactional constraint/lock and execution-time revalidation                           | Concurrent database tests                     |
| Forged or replayed webhooks        | Signature verification, stored event ID, idempotent processing, reconciliation          | Signed/unsigned/replayed webhook tests        |
| False payment confirmation         | Link clicks never mutate payment state; source-labelled ledger records                  | End-to-end payment-boundary test              |
| Malicious uploads                  | Size/type validation, malware scanning, private storage, short-lived authorized URLs    | Upload abuse tests                            |
| Prompt injection/data exfiltration | Tenant-scoped retrieval, untrusted-content boundary, tool allowlists, approval policy   | AI evaluation suite before AI release         |
| PII/secrets in logs                | Structured allowlisted logs, redaction, secret manager, scanning                        | Log tests and secret scan                     |
| Duplicate external effects         | Transactional outbox, idempotency keys, dedupe constraints, DLQ                         | Worker retry tests                            |

## Security release blockers

- Any critical/high unresolved vulnerability
- Failing tenant-separation or role-authorization tests
- Unsigned webhook acceptance
- Public access to raw uploads or tenant documents
- Secrets committed to source or included in browser/mobile bundles
- A payment or entitlement state derived only from a redirect/click

The threat model must be updated at each phase and whenever a new provider or trust boundary is introduced.
