import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function migration(name: string): string {
  return readFileSync(
    new URL(`../../../supabase/migrations/${name}`, import.meta.url),
    'utf8',
  );
}

const enumMigration = migration('202611040001_paddle_live_provider.sql');
const liveMigration = migration('202611040002_paddle_live_billing.sql');

describe('Live Paddle billing migration', () => {
  it('adds the live provider in its own migration', () => {
    expect(enumMigration).toContain(
      "ALTER TYPE public.billing_provider ADD VALUE IF NOT EXISTS 'paddle'",
    );
    expect(liveMigration).not.toContain('ADD VALUE');
  });

  it('keeps live plans out of development-only catalogs', () => {
    expect(liveMigration).toMatch(
      /provider = 'paddle'[\s\S]*?AND NOT is_development_only/,
    );
    expect(liveMigration).toContain(
      "plan.is_development_only = (target_provider = 'paddle_sandbox')",
    );
  });

  it('configures the owner-approved live catalog', () => {
    for (const row of [
      "'starter_monthly', 'paddle', 'Starter', 'month', 'pri_01m6k8spcay1tgqctewmv8jhwh', 2900, 'USD', 3, NULL, 14",
      "'growth_monthly', 'paddle', 'Growth', 'month', 'pri_01m6k8vg3stm76898n4673n648', 7900, 'USD', 10, NULL, 14",
      "'pro_monthly', 'paddle', 'Pro', 'month', 'pri_01m6k8x4a6ehvnyex8bqtgs2ts', 14900, 'USD', 30, NULL, 14",
    ]) {
      expect(liveMigration).toContain(row);
    }
  });

  it('requires checkout only for workspaces created after it ships', () => {
    expect(liveMigration).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(liveMigration).toContain(
      "AND subscription.plan_code = 'development_stub'",
    );
    expect(liveMigration).toContain('WHERE subscription.tenant_id = NEW.id');
  });

  it('keeps provider-specific functions service-role only', () => {
    for (const fn of [
      'apply_paddle_subscription_event',
      'list_paddle_subscriptions_for_reconciliation',
      'begin_paddle_reconciliation',
      'finish_paddle_reconciliation',
      'apply_paddle_reconciliation_snapshot',
      'configure_paddle_live_reconciliation_cron',
    ]) {
      const revoke = liveMigration.indexOf(
        `REVOKE ALL ON FUNCTION public.${fn}(`,
      );
      const grant = liveMigration.indexOf(
        `GRANT EXECUTE ON FUNCTION public.${fn}(`,
      );
      expect(revoke).toBeGreaterThan(-1);
      expect(grant).toBeGreaterThan(-1);
      expect(liveMigration.indexOf('anon, authenticated', revoke)).toBeLessThan(
        liveMigration.indexOf(';', revoke),
      );
      expect(liveMigration.indexOf('TO service_role', grant)).toBeLessThan(
        liveMigration.indexOf(';', grant),
      );
    }
  });
});
