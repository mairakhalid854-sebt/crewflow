export const PADDLE_SANDBOX_TOKEN = /^test_[a-zA-Z\d]+$/;
export const PADDLE_LIVE_TOKEN = /^live_[a-zA-Z\d]+$/;
export const PADDLE_PRICE_ID = /^pri_[a-z\d]{26}$/;
export const TENANT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PaddleEnvironment = 'sandbox' | 'production';
export type PaddleProvider = 'paddle_sandbox' | 'paddle';

export interface CheckoutPlan {
  readonly code: string;
  readonly displayName: string;
  readonly priceId: string;
  readonly amountCents: number;
  readonly currencyCode: string;
  readonly billingInterval: 'month' | 'year';
  readonly seatLimit: number | null;
  readonly trialDays: number;
}

/**
 * The client-side token decides the Paddle environment: Paddle issues `test_`
 * tokens for sandbox and `live_` tokens for production. Preview deployments
 * keep a sandbox token and Production gets the live one, so one build serves
 * both.
 */
export function paddleEnvironmentFromToken(
  token: string | undefined,
): PaddleEnvironment | undefined {
  if (PADDLE_LIVE_TOKEN.test(token ?? '')) return 'production';
  if (PADDLE_SANDBOX_TOKEN.test(token ?? '')) return 'sandbox';
  return undefined;
}

export function paddleProviderFor(
  environment: PaddleEnvironment,
): PaddleProvider {
  return environment === 'production' ? 'paddle' : 'paddle_sandbox';
}

export function isCheckoutConfigured(
  token: string | undefined,
  plans: readonly CheckoutPlan[],
): boolean {
  return (
    paddleEnvironmentFromToken(token) !== undefined &&
    plans.length > 0 &&
    plans.every(
      (plan) =>
        PADDLE_PRICE_ID.test(plan.priceId) &&
        plan.amountCents >= 0 &&
        plan.currencyCode === 'USD',
    )
  );
}

export function checkoutCustomData(tenantId: string): {
  crewflow_tenant_id: string;
} {
  if (!TENANT_ID.test(tenantId)) {
    throw new Error('A valid CrewFlow360 tenant is required for checkout.');
  }
  return { crewflow_tenant_id: tenantId };
}
