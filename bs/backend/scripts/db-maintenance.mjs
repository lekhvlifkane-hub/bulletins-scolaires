import { spawn } from 'node:child_process';

export function connectionEnvironment(connectionString) {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL doit utiliser le protocole PostgreSQL.');
  }

  const environment = { ...process.env };
  environment.PGHOST = decodeURIComponent(url.hostname);
  environment.PGPORT = url.port || '5432';
  environment.PGUSER = decodeURIComponent(url.username);
  environment.PGPASSWORD = decodeURIComponent(url.password);
  environment.PGDATABASE = decodeURIComponent(url.pathname.slice(1));
  environment.PGSSLMODE = url.searchParams.get('sslmode') ?? environment.PGSSLMODE ?? 'prefer';
  return environment;
}

export function waitForProcess(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${child.spawnfile} a échoué (code ${code ?? signal}).`));
    });
  });
}

export function runPsql(environment, database, sql) {
  const env = { ...environment, PGDATABASE: database };
  return new Promise((resolve, reject) => {
    const child = spawn(
      'psql',
      ['--no-psqlrc', '--no-align', '--tuples-only', '--set', 'ON_ERROR_STOP=1', '--command', sql],
      { env, stdio: ['ignore', 'pipe', 'inherit'] },
    );
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(`psql a échoué (code ${code ?? signal}).`));
    });
  });
}
