# Phase 3 progress

Updated: 2026-10-16

## Delivered to staging

### Quotes

- Owner and office users can create and revise draft quotes from a job.
- Quotes support up to 50 line items, quantities, taxable flags, discounts, expiration dates, and tenant tax rates.
- Subtotal, discount allocation, tax, and total are calculated authoritatively in the database.
- Sending a quote creates a one-time-visible customer URL. Only the SHA-256 hash of its 256-bit token is stored.
- Customers can review, accept, or decline through the public token-scoped page without creating an account.
- Accepting a quote advances the job from `quoted` to `accepted`.
- Quote save, send, accept, and decline events are recorded in the audit log.
- Database tenant constraints and RLS keep quote records isolated; anonymous users have no direct table access.

### Invoices and manual payments

- Completed or closed jobs can produce numbered tenant-specific invoice drafts, using accepted quote lines when available.
- Sent invoices are immutable snapshots with due date, tax, discount, paid, and outstanding amounts.
- Each sent invoice has a one-time-visible secure customer URL; only its SHA-256 token hash is stored.
- Businesses may attach their own HTTPS payment page on a public domain. CrewFlow identifies the business as payee and never marks an invoice paid from a link visit.
- Owner and office users can record verified cash, check, external-transfer, or other payments, including partial settlement.
- Owners can append ledger adjustments and void zero-paid invoices with a required reason; original history is retained.
- The dashboard now shows unpaid invoice count and current-month recorded receipts. Customer records show invoices and lifetime recorded paid value.
- Invoice, payment, adjustment, send, and void operations are tenant-authorized and audited.

### Customer work reports

- Completed or closed jobs can produce editable customer-facing work-report drafts.
- Reports capture a verified summary, work performed, optional parts used, and recommendations.
- Drafts remain private until an owner or office user explicitly reviews and approves them.
- Approval locks the snapshot, creates a one-time-visible secure customer URL, and stores only its SHA-256 token hash.
- Publishing a revision invalidates the previous customer link while retaining the historical report and audit trail.
- Public report reads expose only the approved customer-safe projection through a token-scoped database function.
- Report save and approval/send operations are tenant-authorized and audited.

### Downloadable invoices and receipts

- Owner and office users can download any tenant-authorized invoice as a generated PDF.
- Customers can download the same immutable snapshot from the secure token-scoped invoice page.
- Fully paid invoices render as clearly labelled paid receipts; draft, sent, partial, and void states remain explicit.
- PDFs include company/customer context, business-time-zone due date, itemized charges, totals, recorded payments, outstanding balance, and page numbering.
- Downloads are generated on demand with private no-store caching and do not expose raw customer tokens in the document.

## Remaining Phase 3 work

- Transactional email delivery for quotes and invoices
- Follow-up reminders, reconciliation jobs, and broader end-to-end billing tests

Quote and invoice links are copied manually by the owner or office user until transactional email is connected. External service-payment links remain business-owned; CrewFlow does not hold customer funds.
