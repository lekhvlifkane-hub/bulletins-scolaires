import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app';
import { env } from '../src/config/env';
import { prisma } from '../src/db/prisma';
import {
  arreterFileEmails,
  demarrerFileEmails,
  fournisseurConfigure,
  lienConnexion,
  lienReinitialisation,
  mettreEnFileEmail,
  sendInvitationEmail,
  sendPasswordResetEmail,
  tenterEnvoi,
  traiterFileEmails,
} from '../src/services/mailer';
import { cleanTestDb, createSchool, createUser } from './helpers';

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));

vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail }) },
}));

/**
 * Le fournisseur d'envoi est décrit par l'environnement : les tests l'activent ou
 * le désactivent explicitement pour couvrir les deux situations.
 */
function activerFournisseur() {
  env.SMTP_HOST = 'smtp.test.sn';
  env.SMTP_FROM = 'Bulletins Scolaires <no-reply@test.sn>';
}

function desactiverFournisseur() {
  env.SMTP_HOST = undefined;
  env.SMTP_FROM = undefined;
}

describe("File d'attente des e-mails", () => {
  beforeEach(async () => {
    await cleanTestDb();
    sendMail.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    arreterFileEmails();
    desactiverFournisseur();
    vi.restoreAllMocks();
  });

  it('construit les liens à partir de l’adresse publique de l’interface', () => {
    expect(lienConnexion()).toBe(`${env.APP_BASE_URL}/#/connexion`);
    expect(lienReinitialisation('jeton à espaces')).toBe(
      `${env.APP_BASE_URL}/#/reinitialiser-mot-de-passe?token=jeton%20%C3%A0%20espaces`,
    );
  });

  it('met le message en file sans l’envoyer quand aucun fournisseur n’est configuré', async () => {
    desactiverFournisseur();
    const school = await createSchool('Lycée sans SMTP');

    expect(fournisseurConfigure()).toBe(false);
    await sendPasswordResetEmail('prof@ecole.sn', 'jeton-abc', school.id);

    expect(sendMail).not.toHaveBeenCalled();
    const message = await prisma.emailOutbox.findFirstOrThrow();
    expect(message.status).toBe('EN_ATTENTE');
    expect(message.attempts).toBe(0);
    expect(message.to).toBe('prof@ecole.sn');
    expect(message.schoolId).toBe(school.id);
    expect(message.bodyText).toContain(lienReinitialisation('jeton-abc'));
  });

  it('envoie un message d’invitation et y place les identifiants de connexion', async () => {
    desactiverFournisseur();
    const school = await createSchool('Lycée Invitation');

    await sendInvitationEmail({
      to: 'nouveau@ecole.sn',
      temporaryPassword: 'Temporaire-2026a1',
      etablissement: 'Lycée Invitation',
      schoolId: school.id,
    });

    const message = await prisma.emailOutbox.findFirstOrThrow();
    expect(message.subject).toContain('Lycée Invitation');
    expect(message.bodyText).toContain(lienConnexion());
    expect(message.bodyText).toContain('nouveau@ecole.sn');
    expect(message.bodyText).toContain('Temporaire-2026a1');
  });

  it('envoie un message dû puis le marque comme envoyé', async () => {
    activerFournisseur();
    sendMail.mockResolvedValue({});
    const id = await mettreEnFileEmail({
      to: 'destinataire@ecole.sn',
      subject: 'Objet',
      bodyText: 'Corps du message',
    });

    expect(await tenterEnvoi(id)).toBe(true);

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0]).toMatchObject({
      from: env.SMTP_FROM,
      to: 'destinataire@ecole.sn',
      subject: 'Objet',
      text: 'Corps du message',
    });

    const message = await prisma.emailOutbox.findUniqueOrThrow({ where: { id } });
    expect(message.status).toBe('ENVOYE');
    expect(message.attempts).toBe(1);
    expect(message.sentAt).not.toBeNull();
  });

  it('relance un message en échec avec un délai différé', async () => {
    activerFournisseur();
    sendMail.mockRejectedValue(new Error('SMTP 421 service indisponible'));
    const id = await mettreEnFileEmail({
      to: 'destinataire@ecole.sn',
      subject: 'Objet',
      bodyText: 'Corps',
    });

    expect(await tenterEnvoi(id)).toBe(false);

    const message = await prisma.emailOutbox.findUniqueOrThrow({ where: { id } });
    expect(message.status).toBe('EN_ATTENTE');
    expect(message.attempts).toBe(1);
    expect(message.lastError).toContain('SMTP 421');
    expect(message.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('abandonne définitivement après cinq tentatives', async () => {
    activerFournisseur();
    sendMail.mockRejectedValue(new Error('SMTP 421 service indisponible'));
    const id = await mettreEnFileEmail({
      to: 'destinataire@ecole.sn',
      subject: 'Objet',
      bodyText: 'Corps',
    });

    for (let tentative = 0; tentative < 5; tentative += 1) {
      await tenterEnvoi(id);
    }

    const message = await prisma.emailOutbox.findUniqueOrThrow({ where: { id } });
    expect(message.status).toBe('ECHEC');
    expect(message.attempts).toBe(5);
  });

  it('n’envoie jamais deux fois le même message', async () => {
    activerFournisseur();
    sendMail.mockResolvedValue({});
    const id = await mettreEnFileEmail({
      to: 'destinataire@ecole.sn',
      subject: 'Objet',
      bodyText: 'Corps',
    });

    await tenterEnvoi(id);
    expect(await tenterEnvoi(id)).toBe(false);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('ne touche pas à la file quand aucun fournisseur n’est configuré', async () => {
    desactiverFournisseur();
    await mettreEnFileEmail({ to: 'a@ecole.sn', subject: 'Objet', bodyText: 'Corps' });

    expect(await traiterFileEmails()).toEqual({ envoyes: 0, echoues: 0 });
    expect(sendMail).not.toHaveBeenCalled();
    const message = await prisma.emailOutbox.findFirstOrThrow();
    expect(message.status).toBe('EN_ATTENTE');
    expect(message.attempts).toBe(0);
  });

  it('traite la file en respectant l’heure de relance', async () => {
    activerFournisseur();
    sendMail.mockResolvedValue({});
    const du = await mettreEnFileEmail({ to: 'du@ecole.sn', subject: 'Objet', bodyText: 'Corps' });
    const differe = await mettreEnFileEmail({
      to: 'differe@ecole.sn',
      subject: 'Objet',
      bodyText: 'Corps',
    });
    await prisma.emailOutbox.update({
      where: { id: differe },
      data: { nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000) },
    });

    expect(await traiterFileEmails()).toEqual({ envoyes: 1, echoues: 0 });

    const envoye = await prisma.emailOutbox.findUniqueOrThrow({ where: { id: du } });
    const enAttente = await prisma.emailOutbox.findUniqueOrThrow({ where: { id: differe } });
    expect(envoye.status).toBe('ENVOYE');
    expect(enAttente.status).toBe('EN_ATTENTE');
  });

  it('ne démarre pas le traitement périodique pendant les tests', () => {
    activerFournisseur();
    const minuterie = vi.spyOn(globalThis, 'setInterval');

    demarrerFileEmails();

    expect(minuterie).not.toHaveBeenCalled();
  });

  it('ouvre un compte sans mot de passe : l’invitation part en file', async () => {
    desactiverFournisseur();
    const school = await createSchool('Lycée Ouverture');
    await createUser({
      email: 'admin@ouverture.sn',
      password: 'MotDePasse123456',
      role: 'SCHOOL_ADMIN',
      schoolId: school.id,
    });

    const agent = request.agent(app);
    const session = await agent.get('/api/auth/session');
    const login = await agent
      .post('/api/auth/login')
      .set('x-csrf-token', session.body.csrfToken)
      .send({ email: 'admin@ouverture.sn', password: 'MotDePasse123456' });
    const res = await agent
      .post('/api/users')
      .set('x-csrf-token', login.body.csrfToken)
      .send({ name: 'Nouveau Surveillant', email: 'surveillant@ouverture.sn', role: 'SURVEILLANT_GENERAL' });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const invitation = await prisma.emailOutbox.findFirstOrThrow({
      where: { to: 'surveillant@ouverture.sn' },
    });
    expect(invitation.schoolId).toBe(school.id);
    expect(invitation.subject).toContain('Lycée Ouverture');
    expect(invitation.bodyText).toContain('Lycée Ouverture');
    expect(invitation.bodyText).toContain(lienConnexion());
    expect(invitation.bodyText).toContain(res.body.temporaryPassword);
  });
});
