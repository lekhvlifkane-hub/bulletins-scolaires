import { prisma } from '../src/db/prisma';
import { hashPassword } from '../src/lib/password';

async function main() {
  const email = 'platform-admin@e2e.local';
  const password = 'E2E-Only-Password-2026!';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new Error('Le compte plateforme E2E existe déjà après la réinitialisation de la base.');
  }

  await prisma.user.create({
    data: {
      name: 'Administrateur plateforme E2E — FICTIF',
      email,
      passwordHash: await hashPassword(password),
      role: 'PLATFORM_ADMIN',
      schoolId: null,
      isActive: true,
    },
  });
}

main()
  .catch((error: unknown) => {
    console.error('Impossible de créer le compte plateforme E2E :', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
