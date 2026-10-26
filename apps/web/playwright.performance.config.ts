import { defineConfig, devices } from '@playwright/test';

const port = 3012;
const baseURL = `http://127.0.0.1:${port}`;
const useExternalServer = process.env.PLAYWRIGHT_EXTERNAL_SERVER === '1';

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
  testDir: './test/performance',
  timeout: 45_000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: useExternalServer
    ? undefined
    : {
        command: `node ../../node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port ${port}`,
        env: {
          ...process.env,
          NEXT_PUBLIC_APP_URL: baseURL,
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
            process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
            'sb_publishable_performance_test_only',
          NEXT_PUBLIC_SUPABASE_URL:
            process.env.NEXT_PUBLIC_SUPABASE_URL ??
            'https://performance-test.supabase.co',
        },
        reuseExistingServer: false,
        timeout: 120_000,
        url: `${baseURL}/login`,
      },
  workers: 1,
});
