import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const frontendDirectory = path.dirname(fileURLToPath(import.meta.url));
const backendDirectory = path.resolve(frontendDirectory, '..', 'backend');
const e2eDatabaseUrl = process.env.E2E_DATABASE_URL;
if (!e2eDatabaseUrl) {
  throw new Error('Lancez les E2E réels depuis backend avec npm run test:e2e:real.');
}

const origin = 'http://127.0.0.1:1421';
const sessionSecret = 'e2e-only-session-secret-do-not-use-outside-tests';

export default defineConfig({
  testDir: './e2e-real',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: origin,
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev',
      cwd: backendDirectory,
      url: 'http://127.0.0.1:4001/api/health',
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        PORT: '4001',
        DATABASE_URL: e2eDatabaseUrl,
        CORS_ORIGINS: origin,
        SESSION_SECRET: sessionSecret,
        SESSION_COOKIE_SECURE: 'false',
        SESSION_COOKIE_SAMESITE: 'lax',
      },
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 1421',
      cwd: frontendDirectory,
      url: origin,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_PROXY_TARGET: 'http://127.0.0.1:4001' },
    },
  ],
});
