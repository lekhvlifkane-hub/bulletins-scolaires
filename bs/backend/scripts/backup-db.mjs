import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { connectionEnvironment, waitForProcess } from './db-maintenance.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const destination = resolve(process.argv[2] ?? resolve(
  projectRoot,
  'backups',
  `bulletins-${new Date().toISOString().replaceAll(':', '-')}.dump`,
));
const databaseUrl = process.env.DATABASE_URL;

async function main() {
  if (!databaseUrl) throw new Error('DATABASE_URL doit être configurée dans backend/.env.');
  await mkdir(dirname(destination), { recursive: true });

  const environment = connectionEnvironment(databaseUrl);
  const child = spawn(
    'pg_dump',
    ['--format=custom', '--no-owner', '--no-acl'],
    { env: environment, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const output = createWriteStream(destination, { flags: 'wx' });
  let outputCreated = false;
  output.once('open', () => { outputCreated = true; });
  try {
    await Promise.all([
      pipeline(child.stdout, output),
      waitForProcess(child),
    ]);
  } catch (error) {
    child.kill();
    if (outputCreated) await rm(destination, { force: true });
    throw error;
  }

  const hash = createHash('sha256');
  for await (const chunk of createReadStream(destination)) hash.update(chunk);
  const manifest = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    backupFile: basename(destination),
    format: 'PostgreSQL custom archive',
    sha256: hash.digest('hex'),
  };
  await writeFile(`${destination}.json`, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  console.log(`Sauvegarde créée : ${destination}`);
  console.log(`SHA-256 : ${manifest.sha256}`);
}

main().catch((error) => {
  console.error(`Échec de sauvegarde : ${error.message}`);
  process.exitCode = 1;
});
