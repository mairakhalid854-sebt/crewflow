# Transactional email runbook

CrewFlow uses Resend for two separate paths:

1. **Supabase Auth email** (signup confirmation, password reset, invites) via
   Resend SMTP, configured in the Supabase dashboard.
2. **Application email** via Resend's HTTP API:
   - approved Follow-Up payment reminders through
     `process-follow-up-email-deliveries`;
   - opt-in team invitation, quote, and invoice link emails through
     `process-transactional-emails`.

Live sending stays off until a sending domain is owned and verified. All
credentials live only in the Supabase dashboard or Supabase Secrets, never in
Git, Vercel, `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*` variables, logs, or chat.

## What the delivery worker guarantees

- Only messages a human approved and the database marked `ready` are sent.
- Contact and invoice state are revalidated when each message is claimed.
  Suppressed, archived, opted-out, or changed contacts, and invoices that are
  paid or no longer open, are cancelled with `stale_follow_up_state`.
- Marketing review requests stay `ready` and unsent unless the marketing
  switch below is on.
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

## Review requests (marketing)

Review requests are marketing email under CAN-SPAM. Sending is controlled by
the Edge Function secret `CREWFLOW_MARKETING_EMAIL_ENABLED=true` (with
`CREWFLOW_WEB_APP_URL` set). The owner reported counsel approval on
2026-10-28, so the secret is set during email setup; unset it to pause review
requests at any time.

- Only customers with recorded marketing opt-in, a fully paid invoice,
  and no suppression are claimed, rechecked at send time.
- A message is held until the business has a complete street address, city,
  state, and ZIP in company settings; CAN-SPAM requires a postal address.
- Every message gets a footer with the business name, postal address, and an
  unsubscribe link, plus RFC 8058 `List-Unsubscribe` and
  `List-Unsubscribe-Post` headers for one-click unsubscribe in Gmail and
  Yahoo. A message missing any of these fails instead of sending.
- Links are `<customer id>.<HMAC>` signed with the Vault secret
  `crewflow_unsubscribe_signing_key` (created by migration); no token is
  stored. Opening `/unsubscribe/<token>` only shows a confirmation; the
  opt-out happens on the button press or a one-click POST to
  `/api/unsubscribe/<token>`, so link scanners cannot unsubscribe people.
- Unsubscribing clears marketing consent for that customer, cancels their
  queued marketing mail, and leaves service email untouched.

## Appointment emails

When a job is scheduled, rescheduled, or cancelled, a database trigger queues
a plain-text email to the customer on the transactional queue. Owners control
this with **Email customers when appointments are scheduled, changed, or
cancelled** in company settings (on by default).

- Times are shown in the business time zone, for example "Tuesday,
  January 5 from 9:00 AM to 10:00 AM".
- Only customers with transactional email permission and no suppression are
  emailed. Past appointments are not confirmed.
- Each email is keyed to the job and appointment window. If the job is
  rescheduled again before the worker runs, the older email is cancelled and
  only the latest time is sent.
- These emails have no link and cannot be requested through
  `enqueue_transactional_email`.
- Queuing is a side effect: a job update never fails because an email could
  not be queued.

## Invitation, quote, invoice, and work-report emails

The invite, quote, invoice, and work-report forms show an unchecked **Also email the link**
box. Copying the link keeps working whether or not it is ticked.

- The web action sends only the entity id and the one-time token it just
  received. `enqueue_transactional_email` verifies the token against the
  stored hash, requires owner/office (owner for invitations), derives the
  recipient from the customer or invitation record, and renders the subject
  and body itself. Callers cannot choose recipients or content.
- Each issued link is emailed at most once; repeating the request returns the
  same queue row and is not audited again.
- Stored bodies contain a `{{link}}` placeholder and a relative path. The
  worker joins that path to `CREWFLOW_WEB_APP_URL` at send time, so a stored
  row can never point recipients at another host.
- Before each send the worker cancels mail for a revoked, accepted, or expired
  invitation, a quote no longer `sent`, an invoice no longer open, or a
  customer who is suppressed, archived, or opted out.
- The link path is scrubbed when the email is delivered, fails, or is
  cancelled. The queue table is not readable by browser roles.

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
   - `CREWFLOW_WEB_APP_URL`: the exact HTTPS web origin, such as
     `https://app.<domain>`, with no path.
   - `CREWFLOW_MARKETING_EMAIL_ENABLED`: `true` (counsel approval reported by
     the owner on 2026-10-28).
5. Push migrations and deploy both functions:

   ```powershell
   npx.cmd supabase db push
   npx.cmd supabase functions deploy process-follow-up-email-deliveries --no-verify-jwt
   npx.cmd supabase functions deploy resend-email-webhook --no-verify-jwt
   npx.cmd supabase functions deploy process-transactional-emails --no-verify-jwt
   ```

6. In Resend → Webhooks, add
   `https://<project-ref>.supabase.co/functions/v1/resend-email-webhook` for the
   `email.bounced` and `email.complained` events. Copy its signing secret
   (`whsec_...`) into `RESEND_WEBHOOK_SECRET`.
7. In the Supabase SQL editor, enable the two-minute delivery schedule:

   ```sql
   SELECT public.configure_follow_up_email_delivery_cron();
   SELECT public.configure_transactional_email_cron();
   ```

   To pause delivery, unschedule the `crewflow-deliver-follow-up-email` or
   `crewflow-deliver-transactional-email` cron job; ready messages wait
   safely.

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
- With the marketing switch off, a review request stays `ready` and is never
  sent. With it on, the email has the footer and headers, and the
  unsubscribe link opts the customer out after confirmation.
- Removing `RESEND_API_KEY` makes the worker report `configured: false` with no
  attempt consumed.
- A webhook with a modified body or stale timestamp returns 401.
- A ticked invitation, quote, invoice, and work report each arrive once with a working
  link on the configured origin.
- Revoking an invitation before the worker runs cancels its email.
- A quote or invoice for a customer without transactional email permission
  shows the opt-out message and still offers the copyable link.
