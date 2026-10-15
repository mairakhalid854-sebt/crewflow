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

## Remaining Phase 3 work

- Invoice creation from accepted work
- Manual payment ledger and receipts
- Hosted payment-link integration
- Customer-facing work reports
- Transactional email delivery for quotes and invoices
- Reporting, reconciliation, and end-to-end billing tests

The current quote link is copied manually by the owner or office user until transactional email is connected.
