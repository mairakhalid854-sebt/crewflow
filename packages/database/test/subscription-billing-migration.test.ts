import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610190003_phase5_subscription_billing.sql',
    import.meta.url,
  ),
  'utf8',
);
const edgeFunction = readFileSync(
  new URL(
    '../../../supabase/functions/paddle-billing-webhook/index.js',
    import.meta.url,
  ),
  'utf8',
);
const supabaseConfig = readFileSync(
  new URL('../../../supabase/config.toml', import.meta.url),
  'utf8',
);

describe('phase 5 subscription billing foundation', () => {
  it('keeps plans configuration-driven and live billing unavailable', () => {
    expect(migration).toContain(
      "CREATE TYPE public.billing_provider AS ENUM ('stub', 'paddle_sandbox')",
    );
    expect(migration).not.toContain('paddle_live');
    expect(migration).toContain('provider_price_id text');
    expect(migration).toContain('amount_cents bigint');
    expect(migration).toContain("'development_stub'");
    expect(migration).toContain('amount_cents IS NULL');
  });

  it('seeds price-free full-access stub entitlements for every tenant', () => {
    expect(migration).toContain(
      'CREATE FUNCTION public.seed_stub_subscription_for_tenant()',
    );
    expect(migration).toContain('tenants_seed_stub_subscription');
    expect(migration).toContain(
      "SELECT tenant.id, 'development_stub', 'stub', 'active', 'full'",
    );
    expect(migration).toContain(
      'CREATE FUNCTION public.set_stub_subscription_state',
    );
  });

  it('keeps billing internals private and owner detail role-guarded', () => {
    for (const table of [
      'billing_plans',
      'tenant_subscriptions',
      'billing_webhook_events',
    ]) {
      expect(migration).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
      );
      expect(migration).toContain(
        `REVOKE ALL ON public.${table} FROM anon, authenticated`,
      );
    }
    expect(migration).toContain(
      'CREATE FUNCTION public.get_owner_billing_summary()',
    );
    expect(migration).toContain("membership.role = 'owner'");
  });

  it('processes verified events idempotently and rejects stale ordering', () => {
    expect(migration).toContain(
      'CONSTRAINT billing_webhook_events_external_unique',
    );
    expect(migration).toContain(
      'ON CONFLICT (provider, external_event_id) DO NOTHING',
    );
    expect(migration).toContain("RETURN 'duplicate'");
    expect(migration).toContain("RETURN 'payload_conflict'");
    expect(migration).toContain('target_occurred_at < latest_event_at');
    expect(migration).toContain("RETURN 'out_of_order'");
    expect(migration).toContain("auth.role() IS DISTINCT FROM 'service_role'");
  });

  it('preserves data and blocks business writes only in read-only mode', () => {
    expect(migration).toContain(
      "CREATE TYPE public.billing_access_mode AS ENUM ('full', 'grace', 'read_only')",
    );
    expect(migration).toContain("WHEN 'past_due' THEN 'grace'");
    expect(migration).toContain("WHEN 'canceled' THEN 'read_only'");
    expect(migration).toContain(
      "IF current_access = 'read_only' OR current_access IS NULL",
    );
    expect(migration).toContain('customers_require_write_entitlement');
    expect(migration).toContain('jobs_require_write_entitlement');
    expect(migration).toContain('job_media_require_write_entitlement');
    expect(migration).not.toMatch(
      /DELETE FROM public\.(customers|jobs|tenants)/,
    );
  });

  it('verifies Paddle HMAC over the untouched body before parsing', () => {
    const rawBodyRead = edgeFunction.indexOf(
      'const rawBody = await request.text()',
    );
    const signatureCheck = edgeFunction.indexOf('verifyPaddleSignature');
    const jsonParse = edgeFunction.indexOf('JSON.parse(rawBody)');

    expect(rawBodyRead).toBeGreaterThan(-1);
    expect(signatureCheck).toBeGreaterThan(-1);
    expect(jsonParse).toBeGreaterThan(signatureCheck);
    expect(edgeFunction).toContain("request.headers.get('paddle-signature')");
    expect(edgeFunction).toContain("{ name: 'HMAC', hash: 'SHA-256' }");
    expect(edgeFunction).toContain('SIGNATURE_TOLERANCE_SECONDS = 300');
    expect(edgeFunction).toContain('constantTimeEqual');
  });

  it('accepts only subscription events and never logs billing payloads', () => {
    expect(edgeFunction).toContain("'subscription.updated'");
    expect(edgeFunction).toContain("'subscription.canceled'");
    expect(edgeFunction).toContain("'apply_paddle_sandbox_subscription_event'");
    expect(edgeFunction).toContain('target_payload_sha256');
    expect(edgeFunction).not.toContain("console.log('Webhook Data:'");
    expect(edgeFunction).not.toContain('PADDLE_API_KEY');
    expect(supabaseConfig).toContain('[functions.paddle-billing-webhook]');
    expect(supabaseConfig).toContain('verify_jwt = false');
  });
});
