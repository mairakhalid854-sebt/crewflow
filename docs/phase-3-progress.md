# Phase 3 progress

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

## Remaining Phase 3 work

- Customer-facing work reports
- Transactional email delivery for quotes and invoices
- Downloadable invoice receipts/PDFs
- Follow-up reminders, reconciliation jobs, and broader end-to-end billing tests

Quote and invoice links are copied manually by the owner or office user until transactional email is connected. External service-payment links remain business-owned; CrewFlow does not hold customer funds.
