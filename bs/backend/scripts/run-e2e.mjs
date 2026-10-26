import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontendDirectory = path.resolve(backendDirectory, '..', 'frontend');
const baseDatabaseUrl = process.env.DATABASE_URL;

if (!baseDatabaseUrl) {
  throw new Error('DATABASE_URL doit être configurée dans backend/.env avant les tests E2E.');
}

const baseUrl = new URL(baseDatabaseUrl);
if (!['localhost', '127.0.0.1', '::1'].includes(baseUrl.hostname)) {
  throw new Error('Les tests E2E réels sont limités à une base PostgreSQL locale.');
}

const baseDatabase = decodeURIComponent(baseUrl.pathname.slice(1));
if (!/^[a-zA-Z0-9_]+$/.test(baseDatabase) || baseDatabase.endsWith('_e2e')) {
  throw new Error('DATABASE_URL doit viser une base locale ordinaire, pas une base *_e2e.');
}

const e2eUrl = new URL(baseUrl);
e2eUrl.pathname = `/${baseDatabase}_e2e`;
const e2eDatabaseUrl = process.env.E2E_DATABASE_URL ?? e2eUrl.toString();

function normalizedDatabaseUrl(value) {
  const url = new URL(value);
  return `${url.protocol}//${url.hostname}:${url.port || '5432'}/${decodeURIComponent(url.pathname.slice(1))}`;
}

const e2eParsedUrl = new URL(e2eDatabaseUrl);
if (!['localhost', '127.0.0.1', '::1'].includes(e2eParsedUrl.hostname)) {
  throw new Error('E2E_DATABASE_URL doit viser un serveur PostgreSQL local.');
}
if (decodeURIComponent(e2eParsedUrl.pathname.slice(1)) !== `${baseDatabase}_e2e`) {
  throw new Error(`E2E_DATABASE_URL doit viser exclusivement la base locale ${baseDatabase}_e2e.`);
}
if (normalizedDatabaseUrl(e2eDatabaseUrl) === normalizedDatabaseUrl(baseDatabaseUrl)) {
  throw new Error('La base E2E ne peut pas être DATABASE_URL.');
}
if (
  process.env.TEST_DATABASE_URL
  && normalizedDatabaseUrl(e2eDatabaseUrl) === normalizedDatabaseUrl(process.env.TEST_DATABASE_URL)
) {
  throw new Error('La base E2E ne peut pas être TEST_DATABASE_URL.');
}

const preparation = spawnSync(
  process.execPath,
  [path.join(backendDirectory, 'scripts', 'prepare-e2e.mjs')],
  {
    cwd: backendDirectory,
    env: { ...process.env, E2E_DATABASE_URL: e2eDatabaseUrl },
    stdio: 'inherit',
  },
);
if (preparation.error) throw preparation.error;
if (preparation.status !== 0) {
  throw new Error(`La préparation de la base E2E a échoué (code ${preparation.status ?? 'inconnu'}).`);
}

const cli = path.join(frontendDirectory, 'node_modules', '@playwright', 'test', 'cli.js');
const result = spawnSync(
  process.execPath,
  [cli, 'test', '--config', path.join(frontendDirectory, 'playwright.real.config.ts'), ...process.argv.slice(2)],
  {
    cwd: frontendDirectory,
    env: { ...process.env, E2E_DATABASE_URL: e2eDatabaseUrl },
    stdio: 'inherit',
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
