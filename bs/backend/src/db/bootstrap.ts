import { env, MOT_DE_PASSE_ADMIN_PAR_DEFAUT } from '../config/env';
import { hashPassword } from '../lib/password';
import { prisma } from './prisma';

/**
 * Garantit la présence d'un administrateur général (PLATFORM_ADMIN) : c'est
 * lui qui valide l'inscription des établissements ; sans lui, la plateforme
 * est injoignable au premier lancement.
 *
 * Idempotent : aucun compte existant n'est jamais modifié ni recréé. Si
 * l'adresse par défaut est déjà prise par un autre compte, on n'écrit rien
 * (le script `scripts/create-platform-admin.ts` reste l'outil manuel).
 */
export async function assurerAdministrateurGeneral(): Promise<void> {
  const existant = await prisma.user.findFirst({
    where: { role: 'PLATFORM_ADMIN', deletedAt: null },
    select: { id: true },
  });
  if (existant) {
    return;
  }

  const adressePrise = await prisma.user.findUnique({
    where: { email: env.PLATFORM_ADMIN_EMAIL },
    select: { id: true, role: true },
  });
  if (adressePrise) {
    console.warn(
      `Administrateur général non créé : l'adresse ${env.PLATFORM_ADMIN_EMAIL} ` +
        `appartient déjà au compte ${adressePrise.id} (${adressePrise.role}). ` +
        'Utiliser scripts/create-platform-admin.ts pour créer un autre compte.',
    );
    return;
  }

  await prisma.user.create({
    data: {
      name: env.PLATFORM_ADMIN_NAME,
      email: env.PLATFORM_ADMIN_EMAIL,
      passwordHash: await hashPassword(env.PLATFORM_ADMIN_PASSWORD),
      role: 'PLATFORM_ADMIN',
      schoolId: null,
      isActive: true,
    },
  });

  console.log(
    `Administrateur général créé : ${env.PLATFORM_ADMIN_EMAIL} (mot de passe par défaut).`,
  );
  if (env.NODE_ENV === 'production') {
    console.warn(
      "⚠️ Sécurité : se connecter avec ce compte puis changer immédiatement le " +
        'mot de passe (profil → changer de mot de passe).',
    );
    if (env.PLATFORM_ADMIN_PASSWORD === MOT_DE_PASSE_ADMIN_PAR_DEFAUT) {
      console.warn(
        '⚠️ Le mot de passe utilisé est celui par défaut du dépôt : à changer dès la première connexion.',
      );
    }
  }
}
