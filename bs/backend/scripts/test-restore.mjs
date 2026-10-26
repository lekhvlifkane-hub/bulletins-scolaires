import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { connectionEnvironment, runPsql, waitForProcess } from './db-maintenance.mjs';

const archive = resolve(process.argv[2] ?? '');

async function checksum(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function main() {
  if (!process.argv[2]) throw new Error('Indiquez le chemin du fichier .dump à restaurer.');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Le test de restauration ne peut pas être lancé avec NODE_ENV=production.');
  }
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL doit désigner une instance PostgreSQL de test/staging isolée.');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL doit être configurée.');

  const target = new URL(process.env.TEST_DATABASE_URL);
  const source = new URL(process.env.DATABASE_URL);
  if (
    target.hostname === source.hostname &&
    (target.port || '5432') === (source.port || '5432') &&
    target.pathname === source.pathname
  ) {
    throw new Error('TEST_DATABASE_URL et DATABASE_URL pointent vers la même base ; restauration annulée.');
  }

  const manifest = JSON.parse(await readFile(`${archive}.json`, 'utf8'));
  const actualChecksum = await checksum(archive);
  if (actualChecksum !== manifest.sha256) {
    throw new Error('Le SHA-256 ne correspond pas au manifeste ; archive altérée ou incorrecte.');
  }

  const environment = connectionEnvironment(process.env.TEST_DATABASE_URL);
  const temporaryDatabase = `bs_restore_check_${randomBytes(6).toString('hex')}`;
  let created = false;
  try {
    await runPsql(environment, decodeURIComponent(target.pathname.slice(1)), `CREATE DATABASE "${temporaryDatabase}"`);
    created = true;
    const restore = spawn(
      'pg_restore',
      ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', temporaryDatabase, archive],
      { env: environment, stdio: 'inherit' },
    );
    await waitForProcess(restore);

    const tableCount = Number(await runPsql(
      environment,
      temporaryDatabase,
      "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    ));
    if (tableCount < 10) {
      throw new Error(`Restauration incomplète : seulement ${tableCount} tables publiques trouvées.`);
    }
    const migrationCount = Number(await runPsql(
      environment,
      temporaryDatabase,
      'SELECT count(*) FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    ));
    if (migrationCount === 0) throw new Error('Aucune migration Prisma restaurée.');

    console.log(`Restauration vérifiée dans la base temporaire ${temporaryDatabase}.`);
    console.log(`${tableCount} tables et ${migrationCount} migrations Prisma lisibles.`);
    console.log(`Archive vérifiée : ${basename(archive)} (${actualChecksum}).`);
  } finally {
    if (created) {
      await runPsql(environment, decodeURIComponent(target.pathname.slice(1)), `DROP DATABASE "${temporaryDatabase}" WITH (FORCE)`);
    }
  }
}

main().catch((error) => {
  console.error(`Échec du test de restauration : ${error.message}`);
  process.exitCode = 1;
});
