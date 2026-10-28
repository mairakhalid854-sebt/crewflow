# Decisions blocking production rollout

These do not block local Phase 0 development, but they block claims of production readiness or relevant live integrations.

1. Legal entity/person registration, tax advice, Paddle seller approval, and Pakistan payout verification.
2. Subscription plans, monthly/annual prices, grace behavior, seat limits, and AI budgets.
   Trial decided by the owner on 2026-10-28: 7 days for new subscriptions.
   The sandbox catalog script and `billing_plans` use 7 days; rerun
   `scripts/configure-paddle-sandbox.mjs` to update the Paddle sandbox prices
   in place. "One trial per business" is stated in the terms but not yet
   enforced at checkout.
3. Transactional email sending domain and deliverability setup. Resend is the
   chosen provider and the Follow-Up delivery worker, bounce/complaint
   suppression webhook, and Auth SMTP runbook are delivered
   (`docs/transactional-email.md`); a verified domain, credentials, and
   staging acceptance remain.
4. Whether v1 remains external business-owned payment URLs/manual records only, or adds an eligible direct-to-business merchant integration.
5. Service-business tax configuration, off-platform payment wording, and refund/reconciliation ownership.
6. Mobile offline scope for the first release.
7. OpenAI `gpt-6-luna` passed the staging candidate gate. Dispatcher, Intake,
   Report/Invoice, and Follow-Up now have bounded provider-review integrations
   with deterministic fallbacks, audit traces, and human approval boundaries.
   Authenticated staging acceptance remains for Intake, Report/Invoice, and
   Follow-Up; production retention, knowledge-document limits, monthly cost
   caps, and explicit live approval also remain unresolved.
   The private knowledge scanner gateway is implemented, but private hosting,
   ClamAV signature operations, runtime credentials, and staging malware/file
   acceptance remain external rollout work.
8. Contact consent, reminder, review solicitation, privacy, and cross-border processing policies approved by counsel.
   On 2026-10-28 the owner reported counsel approval for review-request
   (marketing) email, so `CREWFLOW_MARKETING_EMAIL_ENABLED=true` is set during
   email setup. Keep the written approval with company records.
9. Final brand/domain clearance. At the owner's request, the published
   privacy notice (`/privacy`) and terms of service (`/terms`) were drafted by
   Claude on 2026-10-28 without counsel-provided text and present CrewFlow as
   an independent brand. Have counsel review the final wording before general
   availability, including the contracting entity, Wyoming governing law, the
   14-day first-charge refund, and the 30-day change notices.
10. Mapping/geocoding provider and budget if travel estimates are required.
11. Exact approved job state machine and cancellation/refund policy.
12. Public review destination and provider rules.
13. Production backup plan/retention, approved RPO and RTO, private Storage
    export, and a completed isolated restore drill with sanitized evidence.
