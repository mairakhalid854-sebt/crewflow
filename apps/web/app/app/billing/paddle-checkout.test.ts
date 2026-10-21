import { describe, expect, it } from 'vitest';

import {
  checkoutCustomData,
  isSandboxCheckoutConfigured,
  type SandboxCheckoutPlan,
} from './paddle-checkout';

const plan: SandboxCheckoutPlan = {
  code: 'starter_monthly_sandbox',
  displayName: 'Starter',
  priceId: 'pri_01h1vjes1y163xfj1rh1tkfb65',
  amountCents: 2900,
  currencyCode: 'USD',
  billingInterval: 'month',
  seatLimit: 3,
  trialDays: 14,
};

describe('Paddle sandbox checkout guards', () => {
  it('requires a sandbox client token and validated catalog plans', () => {
    expect(isSandboxCheckoutConfigured('test_abc123', [plan])).toBe(true);
    expect(isSandboxCheckoutConfigured('live_abc123', [plan])).toBe(false);
    expect(isSandboxCheckoutConfigured('test_abc123', [])).toBe(false);
    expect(
      isSandboxCheckoutConfigured('test_abc123', [
        { ...plan, priceId: 'not-a-price' },
      ]),
    ).toBe(false);
  });

  it('allows only UUID tenant references in checkout custom data', () => {
    expect(checkoutCustomData('fdda765f-fc57-5604-a269-52a7df8164ec')).toEqual({
      crewflow_tenant_id: 'fdda765f-fc57-5604-a269-52a7df8164ec',
    });
    expect(() => checkoutCustomData('tenant-from-query-string')).toThrow(
      'A valid CrewFlow tenant is required for checkout.',
    );
  });
});
