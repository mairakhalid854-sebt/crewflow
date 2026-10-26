# Phase 7 progress

Phase 7 hardening has started. Staging remains synthetic-only and is not a
production environment.

## Web release smoke foundation

- The Next.js web surface sends HSTS, MIME-sniffing protection, a strict
  referrer policy, a least-privilege browser feature policy, disabled DNS
  prefetch, and disabled legacy cross-domain policy files on every route.
- `/api/health` is a minimal non-cacheable liveness endpoint. It exposes no
  environment values, database details, credentials, or customer data.
- `npm run smoke:web -- https://target.example` checks login, privacy, health,
  required security headers, and the unauthenticated `/app` redirect.
- Protected Vercel previews may be tested by setting
  `VERCEL_AUTOMATION_BYPASS_SECRET` in the operator shell. The secret is sent
  only as the Vercel bypass header and must never be committed or printed.
- The smoke runner rejects non-HTTPS remote targets and has deterministic unit
  coverage for successful, insecure-target, and missing-header paths.

Frame restrictions are intentionally not applied globally because FR-060
requires the public Intake experience to be embeddable. A route-specific frame
policy must be validated with the final customer embedding design before
production.

## Remaining Phase 7 gates

- Separate production Supabase, Vercel environment, credentials, storage,
  billing webhooks, email credentials, and AI keys.
- Centralized logs, alert destinations, uptime checks, queue-depth alarms, and
  an incident-response drill.
- Measured load, Core Web Vitals, keyboard, screen-reader, and contrast
  acceptance against representative journeys.
- Provider backup policy plus a tested off-provider export/restore drill.
- Transactional email domain/provider delivery and suppression acceptance.
- Privacy, terms, consent, tax, cross-border, and marketing review by qualified
  counsel.
- Android/iOS installed-device acceptance, developer-account assets, and store
  review.
- Production smoke execution and explicit `staging` to `main` promotion only
  after all release blockers are closed.
