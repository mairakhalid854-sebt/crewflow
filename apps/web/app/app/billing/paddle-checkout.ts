export const PADDLE_SANDBOX_TOKEN = /^test_[a-zA-Z\d]+$/;
export const PADDLE_PRICE_ID = /^pri_[a-z\d]{26}$/;
export const TENANT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SandboxCheckoutPlan {
  readonly code: string;
  readonly displayName: string;
  readonly priceId: string;
  readonly amountCents: number;
  readonly currencyCode: string;
  readonly billingInterval: 'month' | 'year';
  readonly seatLimit: number | null;
  readonly trialDays: number;
}

export function isSandboxCheckoutConfigured(
  token: string | undefined,
  plans: readonly SandboxCheckoutPlan[],
): boolean {
  return (
    PADDLE_SANDBOX_TOKEN.test(token ?? '') &&
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
    throw new Error('A valid CrewFlow tenant is required for checkout.');
  }
  return { crewflow_tenant_id: tenantId };
}
