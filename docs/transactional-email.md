# Transactional email runbook

CrewFlow uses Resend for two separate paths:

1. **Supabase Auth email** (signup confirmation, password reset, invites) via
   Resend SMTP, configured in the Supabase dashboard.
2. **Application email** (approved Follow-Up payment reminders) via the
   `process-follow-up-email-deliveries` Edge Function and Resend's HTTP API.

Live sending stays off until a sending domain is owned and verified. All
credentials live only in the Supabase dashboard or Supabase Secrets, never in
Git, Vercel, `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*` variables, logs, or chat.

## What the delivery worker guarantees

- Only messages a human approved and the database marked `ready` are sent.
- Contact and invoice state are revalidated when each message is claimed.
  Suppressed, archived, opted-out, or changed contacts, and invoices that are
  paid or no longer open, are cancelled with `stale_follow_up_state`.
- Only `transactional` messages are claimed. Marketing review requests stay
  `ready` and unsent until an unsubscribe flow exists and counsel approves
  CAN-SPAM behavior.
- Each send uses the Resend idempotency key `follow-up-<message id>`, so a
  retry after a crash cannot send twice within Resend's idempotency window.
- Leases last two minutes. Failures retry with exponential backoff (5 minutes
  doubling, capped at 4 hours) and fail after five attempts. Resend 400/422
  responses fail immediately; 401/403 retry, so a credential fix does not lose
  queued mail.
- Without `RESEND_API_KEY` and a valid sender address the worker returns
  `configured: false` and leaves messages untouched.
- `delivered` means Resend accepted the message. Permanent bounces and spam
  complaints arrive by signed webhook and suppress the address for every
  tenant (all tenants share the CrewFlow sending domain).
- Emails are sent as `"<Business name> via CrewFlow" <sender address>` with
  `Reply-To` set to the tenant's business email.

## Setup (once a domain is owned)

1. In Resend, add the subdomain `send.<domain>` (keeps the root domain's
   reputation separate) and create the SPF, DKIM, and MX records it shows at
   the domain's DNS host. Add a DMARC record at `_dmarc.<domain>`, starting
   with `v=DMARC1; p=none; rua=mailto:<monitored address>` and moving to
   `p=quarantine` after reports look clean. Wait until Resend shows the domain
   as verified.
2. Create two Resend API keys with **Sending access** restricted to that
   domain: one for Supabase Auth SMTP, one for the Edge Function. Separate keys
   allow independent rotation.
3. **Auth SMTP**: Supabase dashboard → Authentication → SMTP Settings. Host
   `smtp.resend.com`, port `465`, username `resend`, password = the Auth key,
   sender `no-reply@send.<domain>`, sender name `CrewFlow`. Then raise the Auth
   email rate limit; the built-in limit without custom SMTP is only a few per
   hour.
4. **Application secrets** (Supabase → Edge Functions → Secrets):
   - `RESEND_API_KEY`: the Edge Function key.
   - `CREWFLOW_EMAIL_FROM_ADDRESS`: a bare address such as
     `notifications@send.<domain>`.
   - `RESEND_WEBHOOK_SECRET`: from step 6.
5. Push migrations and deploy both functions:

   ```powershell
   npx.cmd supabase db push
   npx.cmd supabase functions deploy process-follow-up-email-deliveries --no-verify-jwt
   npx.cmd supabase functions deploy resend-email-webhook --no-verify-jwt
   ```

6. In Resend → Webhooks, add
   `https://<project-ref>.supabase.co/functions/v1/resend-email-webhook` for the
   `email.bounced` and `email.complained` events. Copy its signing secret
   (`whsec_...`) into `RESEND_WEBHOOK_SECRET`.
7. In the Supabase SQL editor, enable the two-minute delivery schedule:

   ```sql
   SELECT public.configure_follow_up_email_delivery_cron();
   ```

   To pause delivery, unschedule the `crewflow-deliver-follow-up-email` cron
   job; ready messages wait safely.

## Acceptance

Use synthetic customers only. Resend's test recipients simulate outcomes
without harming sender reputation: `delivered@resend.dev`,
`bounced@resend.dev`, and `complained@resend.dev`.

- Signup confirmation and password reset arrive from the CrewFlow sender and
  their links work once each.
- An approved overdue reminder to `delivered@resend.dev` becomes `delivered`
  with a provider message id.
- A reminder to `bounced@resend.dev` triggers the webhook, suppresses that
  customer, and cancels their other ready messages.
- `complained@resend.dev` suppresses the same way.
- A reminder whose invoice is paid after approval is cancelled, not sent.
- A review request stays `ready` and is never sent.
- Removing `RESEND_API_KEY` makes the worker report `configured: false` with no
  attempt consumed.
- A webhook with a modified body or stale timestamp returns 401.

## Not yet delivered

FR-080 also lists invite, quote, invoice, and job-status emails. Those flows
currently share links in the UI; they need templates and enqueue points on
the same queue pattern before production. Review-request sending needs an
unsubscribe link, a suppression endpoint, and counsel sign-off.
