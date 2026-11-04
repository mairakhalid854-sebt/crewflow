// Paddle environment settings shared by the billing Edge Functions. Staging
// and production share one Supabase project, so sandbox and live billing run
// side by side as separate functions with separate secrets.

export const PADDLE_ENVIRONMENTS = Object.freeze({
  sandbox: Object.freeze({
    name: 'sandbox',
    label: 'Paddle sandbox',
    provider: 'paddle_sandbox',
    apiUrl: 'https://sandbox-api.paddle.com',
    apiKeySecret: 'PADDLE_SANDBOX_API_KEY',
    apiKeyPattern: /^pdl_sdbx_apikey_[a-z\d]{26}_[a-zA-Z\d]{22}_[a-zA-Z\d]{3}$/,
    webhookSecret: 'PADDLE_SANDBOX_WEBHOOK_SECRET',
    portalHost: 'sandbox-customer-portal.paddle.com',
  }),
  live: Object.freeze({
    name: 'live',
    label: 'Paddle live',
    provider: 'paddle',
    apiUrl: 'https://api.paddle.com',
    apiKeySecret: 'PADDLE_LIVE_API_KEY',
    apiKeyPattern: /^pdl_live_apikey_[a-z\d]{26}_[a-zA-Z\d]{22}_[a-zA-Z\d]{3}$/,
    webhookSecret: 'PADDLE_LIVE_WEBHOOK_SECRET',
    portalHost: 'customer-portal.paddle.com',
  }),
});

export function paddleEnvironmentForProvider(provider) {
  return Object.values(PADDLE_ENVIRONMENTS).find(
    (environment) => environment.provider === provider,
  );
}
