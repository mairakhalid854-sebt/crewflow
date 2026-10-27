# Decisions blocking production rollout

These do not block local Phase 0 development, but they block claims of production readiness or relevant live integrations.

1. Legal entity/person registration, tax advice, Paddle seller approval, and Pakistan payout verification.
2. Subscription plans, monthly/annual prices, trials, grace behavior, seat limits, and AI budgets.
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
9. Final brand/domain clearance, privacy policy, and terms.
10. Mapping/geocoding provider and budget if travel estimates are required.
11. Exact approved job state machine and cancellation/refund policy.
12. Public review destination and provider rules.
13. Production backup plan/retention, approved RPO and RTO, private Storage
    export, and a completed isolated restore drill with sanitized evidence.
