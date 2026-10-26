import { beforeAll } from 'vitest';
import { config } from 'dotenv';
import { resolve } from 'node:path';

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
// Les tests d'intégration enchaînent les connexions (un agent par scénario) :
// le throttling de connexion n'est pas ce qu'ils mesurent. Le blocage réel du
// compte après des échecs répétés reste couvert par tests/auth.test.ts.
process.env.LOGIN_RATE_LIMIT = '100000';

beforeAll(() => {
  // Rien à faire ici, le schema est appliqué via prisma migrate deploy
});
