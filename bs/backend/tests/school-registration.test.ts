import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/db/prisma';
import { verifyPassword } from '../src/lib/password';
import { cleanTestDb, createSchool, createUser } from './helpers';

const MOT_DE_PASSE = 'MotDePasseAdmin123';

/** Demande d'inscription telle que la page publique l'envoie. */
async function inscrire(surcharge: Record<string, unknown> = {}) {
  const champs = {
    schoolName: 'Lycée de la Médina',
    city: 'Dakar',
    phone: '+221 33 800 00 00',
    adminName: 'Awa Diop',
    adminEmail: 'awa.diop@lycee-medina.sn',
    password: MOT_DE_PASSE,
    ...surcharge,
  };

  const res = await request(app).post('/api/schools/register').send(champs);
  return { res, champs };
}

/** Connexion avec gestion du cookie de session et du jeton CSRF. */
async function connexion(email: string, password: string) {
  const agent = request.agent(app);
  const session = await agent.get('/api/auth/session');
  const res = await agent
    .post('/api/auth/login')
    .set('x-csrf-token', session.body.csrfToken)
    .send({ email, password });

  return { res, agent, csrf: res.body.csrfToken as string | undefined };
}

/** Session d'un administrateur de la plateforme, seul habilité à trancher. */
async function sessionPlateforme() {
  await createUser({
    email: 'plateforme@test.sn',
    password: MOT_DE_PASSE,
    role: 'PLATFORM_ADMIN',
    schoolId: null,
  });
  const { res, agent, csrf } = await connexion('plateforme@test.sn', MOT_DE_PASSE);
  expect(res.status).toBe(200);
  return { agent, csrf: csrf as string };
}

describe('Inscription d’un établissement', () => {
  beforeEach(async () => {
    await cleanTestDb();
  });

  it('crée une demande en attente avec un compte administrateur désactivé', async () => {
    const { res, champs } = await inscrire();

    expect(res.status).toBe(201);

    const ecole = await prisma.school.findFirstOrThrow({
      where: { name: champs.schoolName },
    });
    expect(ecole.status).toBe('PENDING');
    expect(ecole.isActive).toBe(false);
    expect(ecole.city).toBe('Dakar');
    expect(ecole.phone).toBe('+221 33 800 00 00');

    const admin = await prisma.user.findFirstOrThrow({
      where: { email: champs.adminEmail },
    });
    expect(admin.role).toBe('SCHOOL_ADMIN');
    expect(admin.schoolId).toBe(ecole.id);
    expect(admin.isActive).toBe(false);

    // Le mot de passe doit être haché avec le même algorithme que la connexion :
    // sinon l'administrateur ne pourrait jamais se connecter après approbation.
    expect(admin.passwordHash.startsWith('scrypt$')).toBe(true);
    await expect(verifyPassword(MOT_DE_PASSE, admin.passwordHash)).resolves.toBe(true);
  });

  it('met en file l’accusé de réception destiné au futur administrateur', async () => {
    const { champs } = await inscrire();

    const message = await prisma.emailOutbox.findFirstOrThrow();
    expect(message.to).toBe(champs.adminEmail);
    expect(message.subject).toContain("Demande d'inscription reçue");
    expect(message.status).toBe('EN_ATTENTE');
  });

  it('refuse un e-mail déjà utilisé, sans créer d’établissement', async () => {
    const { champs } = await inscrire();

    const seconde = await inscrire({
      schoolName: 'Collège Saint-Michel',
      adminEmail: champs.adminEmail,
    });

    expect(seconde.res.status).toBe(409);
    expect(seconde.res.body.error).toBe('Cet e-mail est déjà utilisé');
    expect(await prisma.school.count({ where: { name: 'Collège Saint-Michel' } })).toBe(0);
  });

  it('refuse un e-mail déjà utilisé par un compte existant', async () => {
    const ecole = await createSchool('Établissement existant');
    await createUser({
      email: 'deja.pris@test.sn',
      password: MOT_DE_PASSE,
      role: 'ASSISTANT',
      schoolId: ecole.id,
    });

    const { res } = await inscrire({ adminEmail: 'deja.pris@test.sn' });

    expect(res.status).toBe(409);
    expect(await prisma.school.count()).toBe(1);
  });

  it('refuse des champs invalides sans rien enregistrer', async () => {
    const invalides = [
      { adminEmail: 'pas-un-e-mail' },
      { schoolName: 'A' },
      { city: '' },
      { phone: '' },
      { adminName: 'A' },
      { password: 'Court1' },
    ];

    for (const surcharge of invalides) {
      const { res } = await inscrire(surcharge);
      expect(res.status).toBe(400);
    }

    expect(await prisma.school.count()).toBe(0);
    expect(await prisma.user.count()).toBe(0);
  });

  it('annonce une demande en cours de validation à la connexion', async () => {
    const { champs } = await inscrire();

    const { res } = await connexion(champs.adminEmail, champs.password);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Votre demande est en cours de validation');
  });
});

describe('Validation des demandes par la plateforme', () => {
  beforeEach(async () => {
    await cleanTestDb();
  });

  it('approuve : établissement actif, compte activé, connexion possible', async () => {
    const { champs } = await inscrire();
    const ecole = await prisma.school.findFirstOrThrow({ where: { name: champs.schoolName } });
    const { agent, csrf } = await sessionPlateforme();

    const res = await agent
      .post(`/api/schools/${ecole.id}/approve`)
      .set('x-csrf-token', csrf);

    expect(res.status).toBe(200);

    const activee = await prisma.school.findUniqueOrThrow({ where: { id: ecole.id } });
    expect(activee.status).toBe('ACTIVE');
    expect(activee.isActive).toBe(true);

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: champs.adminEmail } });
    expect(admin.isActive).toBe(true);

    const messages = await prisma.emailOutbox.findMany({ orderBy: { createdAt: 'asc' } });
    expect(messages.map((m) => m.subject).join(' | ')).toContain('Inscription approuvée');

    // Le contrôle décisif : le mot de passe choisi à l'inscription ouvre la session.
    const apresApprobation = await connexion(champs.adminEmail, champs.password);
    expect(apresApprobation.res.status).toBe(200);
    expect(apresApprobation.res.body.user.email).toBe(champs.adminEmail);
    expect(apresApprobation.res.body.school.id).toBe(ecole.id);
  });

  it('refuse en conservant le motif et le transmet par e-mail', async () => {
    const { champs } = await inscrire();
    const ecole = await prisma.school.findFirstOrThrow({ where: { name: champs.schoolName } });
    const { agent, csrf } = await sessionPlateforme();

    const res = await agent
      .post(`/api/schools/${ecole.id}/reject`)
      .set('x-csrf-token', csrf)
      .send({ reason: 'Dossier administratif incomplet' });

    expect(res.status).toBe(200);

    const refusee = await prisma.school.findUniqueOrThrow({ where: { id: ecole.id } });
    expect(refusee.status).toBe('REJECTED');
    expect(refusee.isActive).toBe(false);

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: champs.adminEmail } });
    expect(admin.isActive).toBe(false);

    const message = await prisma.emailOutbox.findFirstOrThrow({
      where: { subject: { contains: 'Inscription refusée' } },
    });
    expect(message.bodyText).toContain('Dossier administratif incomplet');

    const apresRefus = await connexion(champs.adminEmail, champs.password);
    expect(apresRefus.res.status).toBe(403);
    expect(apresRefus.res.body.error).toBe('Votre demande a été refusée');
  });

  it('refuse une demande sans motif facultatif', async () => {
    const { champs } = await inscrire();
    const ecole = await prisma.school.findFirstOrThrow({ where: { name: champs.schoolName } });
    const { agent, csrf } = await sessionPlateforme();

    const res = await agent
      .post(`/api/schools/${ecole.id}/reject`)
      .set('x-csrf-token', csrf)
      .send({});

    expect(res.status).toBe(200);
    expect(
      (await prisma.school.findUniqueOrThrow({ where: { id: ecole.id } })).status,
    ).toBe('REJECTED');

    const message = await prisma.emailOutbox.findFirstOrThrow({
      where: { subject: { contains: 'Inscription refusée' } },
    });
    expect(message.bodyText).toContain("Aucun motif n'a été précisé");
  });

  it('n’active que l’établissement concerné', async () => {
    await inscrire({ schoolName: 'Lycée Alpha', adminEmail: 'alpha@ecole.sn' });
    await inscrire({ schoolName: 'Lycée Bêta', adminEmail: 'beta@ecole.sn' });

    const alpha = await prisma.school.findFirstOrThrow({ where: { name: 'Lycée Alpha' } });
    const { agent, csrf } = await sessionPlateforme();

    await agent.post(`/api/schools/${alpha.id}/approve`).set('x-csrf-token', csrf);

    const beta = await prisma.school.findFirstOrThrow({ where: { name: 'Lycée Bêta' } });
    expect(beta.status).toBe('PENDING');
    expect(beta.isActive).toBe(false);

    const adminBeta = await prisma.user.findUniqueOrThrow({ where: { email: 'beta@ecole.sn' } });
    expect(adminBeta.isActive).toBe(false);
  });

  it('liste les demandes en attente pour la plateforme seulement', async () => {
    const { champs } = await inscrire();

    const existante = await createSchool('Établissement déjà actif');
    await createUser({
      email: 'admin.ecole@test.sn',
      password: MOT_DE_PASSE,
      role: 'SCHOOL_ADMIN',
      schoolId: existante.id,
    });

    const adminEtablissement = await connexion('admin.ecole@test.sn', MOT_DE_PASSE);
    expect(adminEtablissement.res.status).toBe(200);
    const interdit = await adminEtablissement.agent.get('/api/schools/pending');
    expect(interdit.status).toBe(403);

    const { agent } = await sessionPlateforme();
    const liste = await agent.get('/api/schools/pending');

    expect(liste.status).toBe(200);
    expect(liste.body.schools).toHaveLength(1);
    expect(liste.body.schools[0].name).toBe(champs.schoolName);
    expect(liste.body.schools[0].admin.email).toBe(champs.adminEmail);
  });

  it('exige le jeton CSRF pour approuver ou refuser', async () => {
    const { champs } = await inscrire();
    const ecole = await prisma.school.findFirstOrThrow({ where: { name: champs.schoolName } });
    const { agent } = await sessionPlateforme();

    const approbation = await agent.post(`/api/schools/${ecole.id}/approve`);
    const refus = await agent
      .post(`/api/schools/${ecole.id}/reject`)
      .send({ reason: 'Motif' });

    expect(approbation.status).toBe(403);
    expect(refus.status).toBe(403);

    const inchangee = await prisma.school.findUniqueOrThrow({ where: { id: ecole.id } });
    expect(inchangee.status).toBe('PENDING');
  });
});
