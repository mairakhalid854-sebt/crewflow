# Launch-day checklist: domain, brand, and email

The order to follow once the final product name is chosen and its `.com` is
bought. Each step names the runbook that holds the detail. Nothing here costs
money beyond the domain itself; Resend's free tier covers launch volume.

## 1. Buy the domain

- Register `<name>.com` at Cloudflare Registrar or Namecheap. Turn on
  auto-renew and WHOIS privacy; decline paid add-ons (email, hosting, SSL).
- Keep DNS at the registrar. Cloudflare is preferred because DNS changes
  apply within minutes.

## 2. Rename the product (one pull request)

The internal identifiers (`@crewflow/*` packages, `CREWFLOW_*` variables,
cron job names, Vault secret names, the `crewflow` URL scheme) stay as they
are. Users never see them, and renaming them would break deployed secrets.

1. **Database**: a new migration replaces the one brand function. Every email
   template, push notification, and signature consent reads from it
   (`202610290001_brand_name_function.sql`):

   ```sql
   CREATE OR REPLACE FUNCTION public.product_brand_name()
   RETURNS text
   LANGUAGE sql
   STABLE
   SET search_path = ''
   AS $$
     SELECT '<Name>'::text
   $$;
   ```

   The name must not contain `%`. Update the expected text in the pgTAP tests
   that assert rendered brand text (`brand_name_function`,
   `phase4_push_notifications`, `phase4_job_signatures`,
   `phase7_transactional_email_templates`, `phase7_job_status_emails`).

2. **Web and Edge Functions**: replace the visible name in `apps/web` (pages,
   metadata, Privacy, Terms, invoice PDF) and in the email sender fallback in
   `supabase/functions/_shared/email-delivery.ts` (`"<Business> via <Name>"`).
3. **Mobile**: replace the visible name in `apps/mobile` (`app.json` `name`,
   permission prompts, `App.tsx`, notification copy). The signature consent
   in `apps/mobile/src/jobs/job-signature-policy.ts` must match the database
   text exactly. Change the iOS bundle identifier and Android package
   (`com.crewflow.mobile`) now, because neither can change after the first
   store release.
4. Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`;
   CI runs the database suite.

## 3. Point the web app at the domain

1. Vercel → project → Domains: add `<name>.com` and `www.<name>.com`
   (redirect `www` to the root). Add the DNS records Vercel shows.
2. Supabase → Authentication → URL Configuration: set the Site URL to
   `https://<name>.com` and add `https://<name>.com/**` to the redirect
   allowlist. Keep the existing preview and `crewflow://auth/reset` entries.
   Mirror the change in `supabase/config.toml`.
3. Open `https://<name>.com`, sign up with a fresh address, and confirm that
   the confirmation link opens on the new domain.

## 4. Email (Resend)

Follow [transactional-email.md](transactional-email.md) → "Setup (once a
domain is owned)". In short:

1. Add `send.<name>.com` in Resend and create the SPF, DKIM, and MX records it
   shows. Add `_dmarc.<name>.com` with `v=DMARC1; p=none; rua=mailto:<inbox>`.
2. Create two sending-only API keys: one for Auth SMTP, one for Edge
   Functions.
3. Configure Supabase Auth SMTP (`smtp.resend.com`, port 465, user `resend`,
   sender `no-reply@send.<name>.com`, sender name `<Name>`). Raise the Auth
   email rate limit.
4. Set the Edge Function secrets `RESEND_API_KEY`,
   `CREWFLOW_EMAIL_FROM_ADDRESS=notifications@send.<name>.com`,
   `CREWFLOW_WEB_APP_URL=https://<name>.com`, and
   `CREWFLOW_MARKETING_EMAIL_ENABLED=true`.
5. Push migrations and deploy the three email functions.
6. Add the Resend webhook for `email.bounced` and `email.complained`, then set
   `RESEND_WEBHOOK_SECRET` from its signing secret.
7. Enable the delivery crons:

   ```sql
   SELECT public.configure_follow_up_email_delivery_cron();
   SELECT public.configure_transactional_email_cron();
   ```

8. Run the acceptance list in the runbook. Send an invitation, a quote, an
   invoice, a report, and an appointment change to an inbox you control.
   Confirm that each one arrives, that `Reply` reaches the business, and that a
   review request has a working unsubscribe link.

## 5. Accounts that use the brand

- Paddle: update the business name, product names, and support email; submit
  the live-account review with the new domain and the `/terms` and `/privacy`
  URLs.
- Add a support inbox on the new domain (for example `support@<name>.com`)
  to the contact sections of `/privacy` and `/terms`. They currently list only
  the postal address and phone number, and privacy requests need an email
  route.

## Still open after launch day

See [production-blockers.md](production-blockers.md): a separate production
Supabase project, Vercel production plan, Paddle live approval, counsel review
of the Terms and Privacy notice, staging acceptance for the AI paths, the
scanner VPS (optional at launch), and mobile store submission.
