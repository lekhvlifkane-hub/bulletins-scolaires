import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';
import { prisma } from '../db/prisma';

/**
 * Envoi des e-mails de l'application.
 *
 * Chaque message est d'abord écrit dans la file `EmailOutbox` : si le fournisseur
 * SMTP est momentanément injoignable, le message n'est pas perdu, il est relancé.
 * Sans `SMTP_HOST` configuré (développement, tests), rien n'est envoyé : le lien
 * est affiché dans la console pour que le parcours reste utilisable en local.
 */

/** Nombre de tentatives avant d'abandonner définitivement un message. */
const TENTATIVES_MAX = 5;
/** Attente de la première relance, doublée à chaque échec (1, 2, 4, 8 min). */
const DELAI_RELANCE_MS = 60 * 1000;
/** Fréquence de traitement de la file, en arrière-plan. */
const INTERVALLE_FILE_MS = 60 * 1000;
/** Nombre de messages traités par passage. */
const LOT_FILE = 20;

let transporteur: Transporter | null = null;
let minuteur: NodeJS.Timeout | null = null;

function obtenirTransporteur(): Transporter {
  if (!transporteur) {
    transporteur = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      // Un fournisseur lent ne doit pas immobiliser la requête HTTP en cours.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transporteur;
}

/** Vrai si un fournisseur d'envoi est configuré. */
export function fournisseurConfigure(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_FROM);
}

export function lienConnexion(): string {
  return `${env.APP_BASE_URL}/#/connexion`;
}

export function lienReinitialisation(token: string): string {
  return `${env.APP_BASE_URL}/#/reinitialiser-mot-de-passe?token=${encodeURIComponent(token)}`;
}

type MessageEmail = {
  to: string;
  subject: string;
  bodyText: string;
  schoolId?: string | null;
};

/** Écrit le message dans la file d'attente durable. */
export async function mettreEnFileEmail(message: MessageEmail): Promise<string> {
  const enregistre = await prisma.emailOutbox.create({
    data: {
      schoolId: message.schoolId ?? null,
      to: message.to,
      subject: message.subject,
      bodyText: message.bodyText,
    },
  });
  return enregistre.id;
}

/**
 * Tente d'envoyer un message déjà en file. En cas d'échec, le message reste
 * en attente avec une relance différée ; après `TENTATIVES_MAX`, il passe en ECHEC.
 */
export async function tenterEnvoi(id: string): Promise<boolean> {
  const message = await prisma.emailOutbox.findUnique({ where: { id } });
  if (!message || message.status !== 'EN_ATTENTE') return false;
  if (!fournisseurConfigure()) return false;

  const tentatives = message.attempts + 1;
  try {
    await obtenirTransporteur().sendMail({
      from: env.SMTP_FROM,
      to: message.to,
      subject: message.subject,
      text: message.bodyText,
    });
    await prisma.emailOutbox.update({
      where: { id },
      data: { status: 'ENVOYE', attempts: tentatives, sentAt: new Date(), lastError: null },
    });
    return true;
  } catch (error) {
    const motif = error instanceof Error ? error.message : String(error);
    await prisma.emailOutbox.update({
      where: { id },
      data: {
        status: tentatives >= TENTATIVES_MAX ? 'ECHEC' : 'EN_ATTENTE',
        attempts: tentatives,
        lastError: motif.slice(0, 500),
        nextAttemptAt: new Date(Date.now() + DELAI_RELANCE_MS * 2 ** (tentatives - 1)),
      },
    });
    console.error(`Envoi d'e-mail échoué (${message.to}) : ${motif}`);
    return false;
  }
}

/** Traite les messages en attente dont la relance est due. */
export async function traiterFileEmails(
  limite = LOT_FILE,
): Promise<{ envoyes: number; echoues: number }> {
  if (!fournisseurConfigure()) return { envoyes: 0, echoues: 0 };

  const messages = await prisma.emailOutbox.findMany({
    where: { status: 'EN_ATTENTE', nextAttemptAt: { lte: new Date() } },
    orderBy: { createdAt: 'asc' },
    take: limite,
    select: { id: true },
  });

  let envoyes = 0;
  for (const message of messages) {
    if (await tenterEnvoi(message.id)) envoyes += 1;
  }
  return { envoyes, echoues: messages.length - envoyes };
}

/** Démarre le traitement périodique de la file (sans effet sans fournisseur). */
export function demarrerFileEmails(): void {
  if (minuteur || env.NODE_ENV === 'test' || !fournisseurConfigure()) return;
  minuteur = setInterval(() => {
    void traiterFileEmails().catch((error) => {
      console.error('Traitement de la file d’e-mails interrompu :', error);
    });
  }, INTERVALLE_FILE_MS);
  minuteur.unref();
}

export function arreterFileEmails(): void {
  if (!minuteur) return;
  clearInterval(minuteur);
  minuteur = null;
}

/** Sans fournisseur configuré, on journalise le contenu utile au développeur. */
function journaliserEnDeveloppement(to: string, contenuAAfficher: string): void {
  if (env.NODE_ENV !== 'development') return;
  console.info(`[dev] E-mail destiné à ${to} (aucun SMTP configuré) :\n${contenuAAfficher}`);
}

async function envoyerImmediatement(id: string): Promise<void> {
  if (!fournisseurConfigure()) return;
  await tenterEnvoi(id).catch((error) => {
    console.error('Envoi immédiat impossible :', error);
  });
}

export async function sendPasswordResetEmail(
  to: string,
  token: string,
  schoolId?: string | null,
): Promise<void> {
  const lien = lienReinitialisation(token);
  const corps = [
    'Une réinitialisation du mot de passe a été demandée pour ce compte.',
    '',
    `Lien de réinitialisation (valable 30 minutes) : ${lien}`,
    '',
    "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message :",
    'votre mot de passe reste inchangé.',
  ].join('\n');

  const id = await mettreEnFileEmail({
    to,
    subject: 'Réinitialisation de votre mot de passe',
    bodyText: corps,
    schoolId,
  });
  journaliserEnDeveloppement(to, lien);
  await envoyerImmediatement(id);
}

type InvitationEmail = {
  to: string;
  temporaryPassword: string;
  etablissement: string;
  schoolId: string;
};

export async function sendInvitationEmail({
  to,
  temporaryPassword,
  etablissement,
  schoolId,
}: InvitationEmail): Promise<void> {
  const corps = [
    `Un accès à Bulletins Scolaires vient d'être créé pour vous (${etablissement}).`,
    '',
    `Adresse de connexion : ${lienConnexion()}`,
    `Identifiant : ${to}`,
    `Mot de passe temporaire : ${temporaryPassword}`,
    '',
    'Ce mot de passe est temporaire : changez-le dès la première connexion,',
    "depuis « Mon profil ». Ne le transmettez à personne.",
  ].join('\n');

  const id = await mettreEnFileEmail({
    to,
    subject: `Votre accès à Bulletins Scolaires — ${etablissement}`,
    bodyText: corps,
    schoolId,
  });
  journaliserEnDeveloppement(to, `${lienConnexion()} · identifiant ${to}`);
  await envoyerImmediatement(id);
}
