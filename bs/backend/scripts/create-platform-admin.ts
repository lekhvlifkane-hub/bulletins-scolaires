import { prisma } from '../src/db/prisma';
import { hashPassword } from '../src/lib/password';

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag: string) => {
    const index = args.indexOf(flag);
    if (index >= 0 && args[index + 1]) {
      return args[index + 1];
    }
    return undefined;
  };

  const email = getArg('--email') ?? getArg('-e');
  const name = getArg('--name') ?? getArg('-n');
  const passwordInput = getArg('--password') ?? getArg('-p');

  if (!email || !name) {
    console.error('Utilisation: --email <email> --name <name> [--password <password>]');
    process.exit(1);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    console.error('Un compte existe déjà avec cet e-mail');
    process.exit(1);
  }

  const password = passwordInput ?? Math.random().toString(36).slice(-12) + 'Ab1!';
  const passwordHash = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      role: 'PLATFORM_ADMIN',
      schoolId: null,
      isActive: true,
    },
  });

  console.log('Administrateur plateforme créé');
  console.log(`E-mail : ${user.email}`);
  console.log(`Mot de passe : ${password}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
