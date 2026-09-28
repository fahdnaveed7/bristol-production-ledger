import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/browser', timeout: 30000, fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:4175', channel: process.env.CI ? undefined : 'chrome', headless: true, timezoneId: 'Asia/Kolkata' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4175', url: 'http://127.0.0.1:4175',
    env: { VITE_SUPABASE_URL: 'https://ledger-test.supabase.co', VITE_SUPABASE_ANON_KEY: 'test-publishable-key', NODE_DISABLE_COMPILE_CACHE: '1' },
    reuseExistingServer: false,
  },
})
