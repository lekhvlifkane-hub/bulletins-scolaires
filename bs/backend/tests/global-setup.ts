import { execSync } from 'node:child_process';
import { config } from 'dotenv';
import { resolve } from 'node:path';

export default async function globalSetup() {
  config({ path: resolve(process.cwd(), '.env') });

  const dbUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('TEST_DATABASE_URL ou DATABASE_URL requis pour les tests');
  }

  process.env.DATABASE_URL = dbUrl;
  process.env.NODE_ENV = 'test';
  if (!process.env.SESSION_SECRET) {
    process.env.SESSION_SECRET = 'test-session-secret-123456789012345678901234';
  }
  if (!process.env.LOGIN_RATE_LIMIT) {
    process.env.LOGIN_RATE_LIMIT = '1000';
  }

  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: process.env,
    cwd: process.cwd(),
  });
}
