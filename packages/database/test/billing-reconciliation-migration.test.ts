import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/202610210001_phase5_billing_reconciliation.sql',
    import.meta.url,
  ),
  'utf8',
);
const reconciliationFunction = readFileSync(
  new URL(
    '../../../supabase/functions/reconcile-paddle-billing/index.js',
    import.meta.url,
  ),
  'utf8',
);
const portalFunction = readFileSync(
  new URL(
    '../../../supabase/functions/create-paddle-portal-session/index.js',
    import.meta.url,
  ),
  'utf8',
);
const portalAction = readFileSync(
  new URL('../../../apps/web/app/app/billing/actions.ts', import.meta.url),
  'utf8',
);
const supabaseConfig = readFileSync(
  new URL('../../../supabase/config.toml', import.meta.url),
  'utf8',
);

describe('phase 5 Paddle sandbox reconciliation and portal', () => {
  it('keeps all provider synchronization operations service-only', () => {
    expect(migration).toContain(
      'CREATE FUNCTION public.list_paddle_sandbox_subscriptions_for_reconciliation',
    );
    expect(migration).toContain(
      'CREATE FUNCTION public.apply_paddle_sandbox_reconciliation_snapshot',
    );
    expect(migration).toContain(
      'CREATE FUNCTION public.get_owner_billing_portal_context',
    );
    expect(
      migration.match(/service role required/g)?.length,
    ).toBeGreaterThanOrEqual(7);
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
  });

  it('does not let reconciliation replace webhook data with an older snapshot', () => {
    expect(migration).toContain(
      'target_provider_updated_at < current_subscription.last_provider_event_at',
    );
    expect(migration).toContain("RETURN 'out_of_order'");
    expect(migration).toContain("RETURN 'identity_mismatch'");
    expect(migration).toContain("RETURN 'plan_not_configured'");
    expect(migration).toContain("RETURN 'unchanged'");
  });

  it('records bounded reconciliation results without provider payloads', () => {
    expect(migration).toContain(
      'CREATE TABLE public.billing_reconciliation_runs',
    );
    expect(migration).toContain('checked_count integer');
    expect(migration).toContain('error_code text');
    expect(migration).not.toContain('raw_payload');
    expect(reconciliationFunction).toContain('const BATCH_SIZE = 25');
    expect(reconciliationFunction).toContain('const CONCURRENCY = 5');
    expect(reconciliationFunction).not.toContain('console.log(payload');
  });

  it('pins the sandbox API and refuses live Paddle credentials', () => {
    expect(reconciliationFunction).toContain(
      "const PADDLE_API_URL = 'https://sandbox-api.paddle.com'",
    );
    expect(portalFunction).toContain(
      "const PADDLE_API_URL = 'https://sandbox-api.paddle.com'",
    );
    expect(reconciliationFunction).toContain('pdl_sdbx_apikey_');
    expect(portalFunction).toContain('pdl_sdbx_apikey_');
    expect(reconciliationFunction).not.toContain('pdl_live');
    expect(portalFunction).not.toContain('pdl_live');
    expect(reconciliationFunction).toContain("'paddle-version': '1'");
  });

  it('creates temporary portal sessions only for authenticated owners', () => {
    expect(portalFunction).toContain('admin.auth.getUser(token)');
    expect(portalFunction).toContain("'get_owner_billing_portal_context'");
    expect(portalFunction).toContain(
      'subscription_ids: [context.provider_subscription_id]',
    );
    expect(portalFunction).toContain(
      "const PORTAL_HOST = 'sandbox-customer-portal.paddle.com'",
    );
    expect(portalFunction).toContain("'cache-control': 'no-store'");
    expect(portalFunction.indexOf('admin.auth.getUser(token)')).toBeLessThan(
      portalFunction.indexOf('PADDLE_SANDBOX_KEY.test(paddleApiKey)'),
    );
    expect(portalAction).toContain("await requireTenantContext(['owner'])");
    expect(portalAction).toContain("'sandbox-customer-portal.paddle.com'");
  });

  it('ships the scheduler dormant until sandbox credentials are configured', () => {
    expect(migration).toContain(
      'CREATE FUNCTION public.configure_paddle_reconciliation_cron()',
    );
    expect(migration).toContain("'17 * * * *'");
    expect(migration).not.toContain(
      'SELECT public.configure_paddle_reconciliation_cron()',
    );
    expect(reconciliationFunction).toContain(
      "return json({ error: 'Paddle sandbox reconciliation is dormant.' }, 503)",
    );
    expect(supabaseConfig).toContain('[functions.reconcile-paddle-billing]');
    expect(supabaseConfig).toContain(
      '[functions.create-paddle-portal-session]',
    );
  });
});
