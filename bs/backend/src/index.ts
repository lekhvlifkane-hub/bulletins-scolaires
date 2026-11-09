import app from './app';
import { assurerAdministrateurGeneral } from './db/bootstrap';
import { env } from './config/env';
import { prisma } from './db/prisma';

async function main(): Promise<void> {
  await prisma.$connect();
  // Doit tourner avant l'écoute : sans administrateur général instancié, personne
  // ne peut valider l'inscription des établissements.
  await assurerAdministrateurGeneral();

  const server = app.listen(env.PORT, () => {
    console.log(`API Bulletins Scolaires : http://localhost:${env.PORT}`);
    console.log(`Documentation OpenAPI : http://localhost:${env.PORT}/api/docs`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`Arrêt demandé (${signal})...`);
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch(async (error) => {
  console.error('Impossible de démarrer l’API :', error);
  await prisma.$disconnect();
  process.exit(1);
});
