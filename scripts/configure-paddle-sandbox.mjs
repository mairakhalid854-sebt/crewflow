/* global URL, console, fetch, process */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const API_ORIGIN = 'https://sandbox-api.paddle.com';
const API_KEY_PATTERN =
  /^pdl_sdbx_apikey_[a-z\d]{26}_[a-zA-Z\d]{22}_[a-zA-Z\d]{3}$/;
const OUTPUT_DIRECTORY = resolve('output');

const plans = [
  {
    code: 'starter_monthly_sandbox',
    displayName: 'Starter',
    productName: 'CrewFlow Starter',
    description: 'CrewFlow subscription for small field-service teams.',
    amountCents: 2900,
    seatLimit: 3,
    trialDays: 14,
  },
  {
    code: 'growth_monthly_sandbox',
    displayName: 'Growth',
    productName: 'CrewFlow Growth',
    description: 'CrewFlow subscription for growing field-service teams.',
    amountCents: 7900,
    seatLimit: 10,
    trialDays: 14,
  },
  {
    code: 'pro_monthly_sandbox',
    displayName: 'Pro',
    productName: 'CrewFlow Pro',
    description: 'CrewFlow subscription for established field-service teams.',
    amountCents: 14900,
    seatLimit: 30,
    trialDays: 14,
  },
];

function requireApiKey() {
  const key = process.env.PADDLE_SANDBOX_CATALOG_API_KEY;
  if (!key || !API_KEY_PATTERN.test(key)) {
    throw new Error(
      'Set a valid PADDLE_SANDBOX_CATALOG_API_KEY for this process. The key needs product, price, and client-token read/write permissions.',
    );
  }
  return key;
}

async function paddleRequest(apiKey, pathOrUrl, options = {}) {
  const url = new URL(pathOrUrl, API_ORIGIN);
  if (url.origin !== API_ORIGIN) {
    throw new Error('Paddle pagination returned an unexpected API origin.');
  }

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'paddle-version': '1',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => undefined);

  if (!response.ok) {
    const code = payload?.error?.code ?? `http_${response.status}`;
    throw new Error(`Paddle request failed (${code}).`);
  }
  return payload;
}

async function listAll(apiKey, path) {
  const items = [];
  let next = new URL(path, API_ORIGIN).toString();

  while (next) {
    const payload = await paddleRequest(apiKey, next);
    if (!Array.isArray(payload?.data)) {
      throw new Error('Paddle returned an invalid list response.');
    }
    items.push(...payload.data);
    next = payload.meta?.pagination?.next ?? '';
  }
  return items;
}

function oneMatch(items, predicate, entityName) {
  const matches = items.filter(predicate);
  if (matches.length > 1) {
    throw new Error(
      `More than one active Paddle ${entityName} matches CrewFlow. Archive duplicates in the dashboard and rerun.`,
    );
  }
  return matches[0];
}

async function ensureProduct(apiKey, plan, allProducts) {
  const existing = oneMatch(
    allProducts,
    (product) =>
      product.status === 'active' &&
      product.custom_data?.crewflow_plan_code === plan.code,
    `product for ${plan.code}`,
  );
  if (existing) return existing;

  const payload = await paddleRequest(apiKey, '/products', {
    method: 'POST',
    body: {
      name: plan.productName,
      description: plan.description,
      tax_category: 'saas',
      custom_data: {
        crewflow_environment: 'sandbox',
        crewflow_plan_code: plan.code,
      },
    },
  });
  return payload.data;
}

async function ensurePrice(apiKey, plan, productId) {
  const productPrices = await listAll(
    apiKey,
    `/prices?status=active&product_id=${encodeURIComponent(productId)}&per_page=200`,
  );
  const existing = oneMatch(
    productPrices,
    (price) => price.custom_data?.crewflow_plan_code === plan.code,
    `price for ${plan.code}`,
  );

  if (existing) {
    const correctShape =
      existing.unit_price?.amount === String(plan.amountCents) &&
      existing.unit_price?.currency_code === 'USD' &&
      existing.billing_cycle?.interval === 'month' &&
      existing.billing_cycle?.frequency === 1 &&
      existing.trial_period?.interval === 'day' &&
      existing.trial_period?.frequency === plan.trialDays;
    if (!correctShape) {
      throw new Error(
        `Existing Paddle price for ${plan.code} does not match the approved CrewFlow terms. Archive it before rerunning.`,
      );
    }
    return existing;
  }

  const payload = await paddleRequest(apiKey, '/prices', {
    method: 'POST',
    body: {
      product_id: productId,
      name: 'Monthly',
      description: `${plan.displayName} monthly with ${plan.trialDays}-day trial`,
      billing_cycle: { interval: 'month', frequency: 1 },
      trial_period: { interval: 'day', frequency: plan.trialDays },
      unit_price: { amount: String(plan.amountCents), currency_code: 'USD' },
      tax_mode: 'account_setting',
      quantity: { minimum: 1, maximum: 1 },
      custom_data: {
        crewflow_environment: 'sandbox',
        crewflow_plan_code: plan.code,
      },
    },
  });
  return payload.data;
}

async function ensureClientToken(apiKey) {
  const tokenName = 'CrewFlow sandbox web checkout';
  const tokens = await listAll(
    apiKey,
    '/client-tokens?status=active&per_page=200',
  );
  const existing = oneMatch(
    tokens,
    (token) => token.status === 'active' && token.name === tokenName,
    'client-side token',
  );
  if (existing?.token) return existing;

  const payload = await paddleRequest(apiKey, '/client-tokens', {
    method: 'POST',
    body: {
      name: tokenName,
      description:
        'Used only by the CrewFlow web app to open sandbox checkout.',
    },
  });
  return payload.data;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function catalogSql(catalog) {
  const rows = catalog.plans
    .map(
      (plan) =>
        `(${[
          sqlLiteral(plan.code),
          sqlLiteral('paddle_sandbox'),
          sqlLiteral(plan.displayName),
          sqlLiteral('month'),
          sqlLiteral(plan.priceId),
          plan.amountCents,
          sqlLiteral('USD'),
          plan.seatLimit,
          'NULL',
          plan.trialDays,
          'true',
          'true',
        ].join(', ')})`,
    )
    .join(',\n  ');

  return `-- Generated by scripts/configure-paddle-sandbox.mjs.\n-- Contains public Paddle entity IDs only; no API credentials.\n\nINSERT INTO public.billing_plans (\n  code, provider, display_name, billing_interval, provider_price_id,\n  amount_cents, currency_code, seat_limit, ai_monthly_budget_cents,\n  trial_days, is_active, is_development_only\n) VALUES\n  ${rows}\nON CONFLICT (code) DO UPDATE SET\n  provider = EXCLUDED.provider,\n  display_name = EXCLUDED.display_name,\n  billing_interval = EXCLUDED.billing_interval,\n  provider_price_id = EXCLUDED.provider_price_id,\n  amount_cents = EXCLUDED.amount_cents,\n  currency_code = EXCLUDED.currency_code,\n  seat_limit = EXCLUDED.seat_limit,\n  ai_monthly_budget_cents = EXCLUDED.ai_monthly_budget_cents,\n  trial_days = EXCLUDED.trial_days,\n  is_active = EXCLUDED.is_active,\n  is_development_only = EXCLUDED.is_development_only;\n`;
}

async function main() {
  const apiKey = requireApiKey();
  const allProducts = await listAll(
    apiKey,
    '/products?status=active&per_page=200',
  );
  const catalogPlans = [];

  for (const plan of plans) {
    const product = await ensureProduct(apiKey, plan, allProducts);
    const price = await ensurePrice(apiKey, plan, product.id);
    catalogPlans.push({
      ...plan,
      productId: product.id,
      priceId: price.id,
    });
  }

  const clientToken = await ensureClientToken(apiKey);
  if (!/^test_[a-zA-Z\d]+$/.test(clientToken?.token ?? '')) {
    throw new Error('Paddle did not return a sandbox client-side token.');
  }

  const catalog = {
    environment: 'sandbox',
    generatedAt: new Date().toISOString(),
    clientToken: clientToken.token,
    plans: catalogPlans,
  };
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const jsonPath = resolve(OUTPUT_DIRECTORY, 'paddle-sandbox-catalog.json');
  const sqlPath = resolve(OUTPUT_DIRECTORY, 'paddle-sandbox-plans.sql');
  await writeFile(jsonPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  await writeFile(sqlPath, catalogSql(catalog), 'utf8');

  console.log('Paddle sandbox catalog is ready.');
  console.log(`Catalog mapping: ${jsonPath}`);
  console.log(`Database plan SQL: ${sqlPath}`);
  console.log(
    'The API key was not written to disk. The generated client-side token is browser-safe.',
  );
}

await main();
