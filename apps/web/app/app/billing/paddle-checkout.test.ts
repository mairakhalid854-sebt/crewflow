import { describe, expect, it } from 'vitest';

import {
  checkoutCustomData,
  isCheckoutConfigured,
  paddleEnvironmentFromToken,
  paddleProviderFor,
  type CheckoutPlan,
} from './paddle-checkout';

const plan: CheckoutPlan = {
  code: 'starter_monthly',
  displayName: 'Starter',
  priceId: 'pri_01h1vjes1y163xfj1rh1tkfb65',
  amountCents: 2900,
  currencyCode: 'USD',
  billingInterval: 'month',
  seatLimit: 3,
  trialDays: 14,
};

describe('Paddle checkout guards', () => {
  it('derives the Paddle environment from the client-side token', () => {
    expect(paddleEnvironmentFromToken('test_abc123')).toBe('sandbox');
    expect(paddleEnvironmentFromToken('live_abc123')).toBe('production');
    expect(paddleEnvironmentFromToken('pdl_live_apikey_secret')).toBe(
      undefined,
    );
    expect(paddleEnvironmentFromToken(undefined)).toBe(undefined);
    expect(paddleProviderFor('production')).toBe('paddle');
    expect(paddleProviderFor('sandbox')).toBe('paddle_sandbox');
  });

  it('requires a client token and validated catalog plans', () => {
    expect(isCheckoutConfigured('test_abc123', [plan])).toBe(true);
    expect(isCheckoutConfigured('live_abc123', [plan])).toBe(true);
    expect(isCheckoutConfigured('', [plan])).toBe(false);
    expect(isCheckoutConfigured('live_abc123', [])).toBe(false);
    expect(
      isCheckoutConfigured('live_abc123', [
        { ...plan, priceId: 'not-a-price' },
      ]),
    ).toBe(false);
    expect(
      isCheckoutConfigured('live_abc123', [{ ...plan, currencyCode: 'EUR' }]),
    ).toBe(false);
  });

  it('allows only UUID tenant references in checkout custom data', () => {
    expect(checkoutCustomData('fdda765f-fc57-5604-a269-52a7df8164ec')).toEqual({
      crewflow_tenant_id: 'fdda765f-fc57-5604-a269-52a7df8164ec',
    });
    expect(() => checkoutCustomData('tenant-from-query-string')).toThrow(
      'A valid CrewFlow360 tenant is required for checkout.',
    );
  });
});
