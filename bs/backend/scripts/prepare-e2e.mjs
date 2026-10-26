import 'dotenv/config';
import { Client } from 'pg';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databaseUrl = process.env.E2E_DATABASE_URL;
const baseDatabaseUrl = process.env.DATABASE_URL;
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

function normalizedDatabaseUrl(value) {
  const url = new URL(value);
  return `${url.protocol}//${url.hostname}:${url.port || '5432'}/${decodeURIComponent(url.pathname.slice(1))}`;
}

if (!databaseUrl || !baseDatabaseUrl) {
  throw new Error('DATABASE_URL et E2E_DATABASE_URL sont obligatoires pour préparer les tests E2E.');
}

const target = new URL(databaseUrl);
const base = new URL(baseDatabaseUrl);
const targetName = decodeURIComponent(target.pathname.slice(1));
const baseName = decodeURIComponent(base.pathname.slice(1));
if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname)) {
  throw new Error('Refus de préparer une base E2E distante : seule une instance PostgreSQL locale est autorisée.');
}
if (
  target.protocol !== 'postgresql:'
  && target.protocol !== 'postgres:'
) {
  throw new Error('E2E_DATABASE_URL doit utiliser le protocole PostgreSQL.');
}
if (targetName !== `${baseName}_e2e` || !/^[a-zA-Z0-9_]+$/.test(targetName)) {
  throw new Error(`Refus de réinitialiser une base hors cible : le nom doit être exactement ${baseName}_e2e.`);
}
if (
  normalizedDatabaseUrl(databaseUrl) === normalizedDatabaseUrl(baseDatabaseUrl)
  || (testDatabaseUrl && normalizedDatabaseUrl(databaseUrl) === normalizedDatabaseUrl(testDatabaseUrl))
) {
  throw new Error('Refus de réinitialiser la base applicative ou la base de tests.');
}
if (target.hostname !== base.hostname || (target.port || '5432') !== (base.port || '5432')) {
  throw new Error('E2E_DATABASE_URL doit utiliser le même serveur PostgreSQL local que DATABASE_URL.');
}

const adminUrl = new URL(baseDatabaseUrl);
adminUrl.pathname = '/postgres';
const client = new Client({ connectionString: adminUrl.toString() });
await client.connect();
try {
  const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [targetName]);
  if (existing.rowCount === 0) {
    await client.query(`CREATE DATABASE "${targetName}"`);
  }
} finally {
  await client.end();
}

function runNode(script, args, environment) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: backendDirectory,
    env: environment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(script)} a échoué (code ${result.status ?? 'inconnu'}).`);
  }
}

runNode(
  path.join(backendDirectory, 'node_modules', 'prisma', 'build', 'index.js'),
  ['migrate', 'reset', '--force', '--skip-seed', '--skip-generate', '--schema', 'prisma/schema.prisma'],
  { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test' },
);
runNode(
  path.join(backendDirectory, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
  ['scripts/seed-e2e.ts'],
  { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test' },
);

console.log(`Base E2E locale préparée et réinitialisée : ${targetName}`);
