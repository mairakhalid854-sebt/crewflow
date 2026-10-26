import { defineConfig, devices } from '@playwright/test';

const port = 3011;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  expect: { timeout: 5_000 },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
  reporter: process.env.CI ? 'github' : 'line',
  retries: process.env.CI ? 1 : 0,
  testDir: './test/accessibility',
  timeout: 30_000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node ../../node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port ${port}`,
    env: {
      ...process.env,
      NEXT_PUBLIC_APP_URL: baseURL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
        'sb_publishable_accessibility_test_only',
      NEXT_PUBLIC_SUPABASE_URL:
        process.env.NEXT_PUBLIC_SUPABASE_URL ??
        'https://accessibility-test.supabase.co',
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: `${baseURL}/login`,
  },
  workers: 1,
});
