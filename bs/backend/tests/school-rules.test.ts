import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/db/prisma';
import { parametresEtablissement } from '../src/services/calcul/etablissement';
import { cleanTestDb, createSchool, createUser } from './helpers';

async function loginAs(email: string, password: string) {
  const agent = request.agent(app);
  const session = await agent.get('/api/auth/session');
  const csrf = session.body.csrfToken;
  const login = await agent
    .post('/api/auth/login')
    .set('x-csrf-token', csrf)
    .send({ email, password });
  return {
    csrf: login.body.csrfToken ?? csrf,
    agent,
  };
}

/** PNG 1×1 valide, suffisant pour vérifier le transport et le stockage du logo. */
const LOGO_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

/** Toutes les règles que l'écran « Paramètres établissement » peut enregistrer. */
const REGLES_MODIFIEES = {
  regleCalculMatiere: 'MOYENNE_TOUTES_NOTES',
  poidsDevoirs: 2,
  poidsCompositions: 3,
  poidsAutres: 0.5,
  absencesComptentZero: true,
  groupeSansNote: 'BLOQUANT',
  coefficientInvalide: 'ERREUR',
  baremeParDefaut: 10,
  arrondiDecimales: 3,
  arrondiMode: 'HALF_EVEN',
  rangMode: 'DENSE',
  classerResultatsIncomplets: true,
  poidsSemestre1: 1,
  poidsSemestre2: 2,
  annuelSiSemestreManquant: 'PARTIEL',
};

describe("Règles de calcul de l'établissement", () => {
  beforeEach(async () => {
    await cleanTestDb();
  });

  it('expose les règles par défaut, identiques à celles du moteur de calcul', async () => {
    const school = await createSchool('École règles par défaut');
    await createUser({
      email: 'regles@ecole.sn',
      password: 'MotDePasse123456',
      role: 'SCHOOL_ADMIN',
      schoolId: school.id,
    });

    const { agent } = await loginAs('regles@ecole.sn', 'MotDePasse123456');
    const res = await agent.get('/api/schools/mine');

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.school).toMatchObject({
      regleCalculMatiere: 'POIDS_GROUPES',
      poidsDevoirs: '1',
      poidsCompositions: '1',
      poidsAutres: '0',
      absencesComptentZero: false,
      groupeSansNote: 'EXCLURE',
      coefficientInvalide: 'EXCLURE',
      baremeParDefaut: '20',
      arrondiDecimales: 2,
      arrondiMode: 'HALF_UP',
      rangMode: 'STANDARD',
      classerResultatsIncomplets: false,
      poidsSemestre1: '1',
      poidsSemestre2: '1',
      annuelSiSemestreManquant: 'NULL',
    });
  });

  it("enregistre les règles saisies et les transmet au moteur de calcul", async () => {
    const school = await createSchool('École règles modifiées');
    await createUser({
      email: 'regles@ecole.sn',
      password: 'MotDePasse123456',
      role: 'SCHOOL_ADMIN',
      schoolId: school.id,
    });

    const { csrf, agent } = await loginAs('regles@ecole.sn', 'MotDePasse123456');
    const res = await agent
      .patch(`/api/schools/${school.id}`)
      .set('x-csrf-token', csrf)
      .send(REGLES_MODIFIEES);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.school.regleCalculMatiere).toBe('MOYENNE_TOUTES_NOTES');

    const enBase = await prisma.school.findUniqueOrThrow({ where: { id: school.id } });
    expect(enBase.poidsCompositions.toString()).toBe('3');
    expect(enBase.annuelSiSemestreManquant).toBe('PARTIEL');

    // Les paramètres réellement utilisés par les calculs suivent ce qui a été enregistré.
    const parametres = parametresEtablissement(enBase);
    expect(parametres.regleMatiere).toBe('MOYENNE_TOUTES_NOTES');
    expect(parametres.rangMode).toBe('dense');
    expect(parametres.arrondi).toBe('half-even');
    expect(parametres.decimalsAffichage).toBe(3);
    expect(parametres.absencesComptentZero).toBe(true);
    expect(parametres.groupeSansNote).toBe('bloquant');
    expect(parametres.coefficientInvalide).toBe('erreur');
    expect(parametres.classerResultatsIncomplets).toBe(true);
    expect(parametres.annuelSiSemestreManquant).toBe('partiel');
    expect(parametres.baremeParDefaut).toBe('10');
    expect(parametres.poidsGroupes).toEqual({ DEVOIR: '2', COMPOSITION: '3', AUTRE: '0.5' });
    expect(parametres.poidsSemestres).toEqual({ s1: '1', s2: '2' });
  });

  it('refuse une règle hors liste sans modifier la valeur enregistrée', async () => {
    const school = await createSchool('École règles invalides');
    await createUser({
      email: 'regles@ecole.sn',
      password: 'MotDePasse123456',
      role: 'SCHOOL_ADMIN',
      schoolId: school.id,
    });

    const { csrf, agent } = await loginAs('regles@ecole.sn', 'MotDePasse123456');

    for (const charge of [
      { rangMode: 'ALEATOIRE' },
      { arrondiMode: 'HALF_DOWN' },
      { annuelSiSemestreManquant: 'INVENTE' },
      { regleCalculMatiere: 'MOYENNE_SIMPLE' },
      { arrondiDecimales: 7 },
      { baremeParDefaut: 0 },
      { poidsDevoirs: -1 },
    ]) {
      const res = await agent
        .patch(`/api/schools/${school.id}`)
        .set('x-csrf-token', csrf)
        .send(charge);
      expect(res.status, JSON.stringify(charge)).toBe(400);
    }

    const enBase = await prisma.school.findUniqueOrThrow({ where: { id: school.id } });
    expect(enBase.rangMode).toBe('STANDARD');
    expect(enBase.arrondiMode).toBe('HALF_UP');
    expect(enBase.regleCalculMatiere).toBe('POIDS_GROUPES');
    expect(enBase.arrondiDecimales).toBe(2);
    expect(enBase.poidsDevoirs.toString()).toBe('1');
  });

  it("un administrateur d'établissement ne peut pas modifier les règles d'un autre établissement", async () => {
    const e1 = await createSchool('École 1');
    const e2 = await createSchool('École 2');
    await createUser({
      email: 'admin@e1.sn',
      password: 'MotDePasse123456',
      role: 'SCHOOL_ADMIN',
      schoolId: e1.id,
    });

    const { csrf, agent } = await loginAs('admin@e1.sn', 'MotDePasse123456');
    const res = await agent
      .patch(`/api/schools/${e2.id}`)
      .set('x-csrf-token', csrf)
      .send({ rangMode: 'DENSE' });

    expect(res.status).toBe(403);
    const enBase = await prisma.school.findUniqueOrThrow({ where: { id: e2.id } });
    expect(enBase.rangMode).toBe('STANDARD');
  });

  it("un surveillant général ne peut pas enregistrer les règles de calcul", async () => {
    const school = await createSchool('École surveillant');
    await createUser({
      email: 'surveillant@ecole.sn',
      password: 'MotDePasse123456',
      role: 'SURVEILLANT_GENERAL',
      schoolId: school.id,
    });

    const { csrf, agent } = await loginAs('surveillant@ecole.sn', 'MotDePasse123456');
    const res = await agent
      .patch(`/api/schools/${school.id}`)
      .set('x-csrf-token', csrf)
      .send({ rangMode: 'DENSE' });

    expect(res.status).toBe(403);
  });

  it('exige un jeton CSRF pour enregistrer les règles', async () => {
    const school = await createSchool('École sans CSRF');
    await createUser({
      email: 'regles@ecole.sn',
      password: 'MotDePasse123456',
      role: 'SCHOOL_ADMIN',
      schoolId: school.id,
    });

    const { agent } = await loginAs('regles@ecole.sn', 'MotDePasse123456');
    const res = await agent.patch(`/api/schools/${school.id}`).send({ rangMode: 'DENSE' });

    expect(res.status).toBe(403);
  });

  it('enregistre un logo PNG et permet de le retirer', async () => {
    const school = await createSchool('École avec logo');
    await createUser({
      email: 'logo@ecole.sn',
      password: 'MotDePasse123456',
      role: 'SCHOOL_ADMIN',
      schoolId: school.id,
    });

    const { csrf, agent } = await loginAs('logo@ecole.sn', 'MotDePasse123456');
    const enregistre = await agent
      .patch(`/api/schools/${school.id}`)
      .set('x-csrf-token', csrf)
      .send({ logoDataUrl: LOGO_PNG });

    expect(enregistre.status, JSON.stringify(enregistre.body)).toBe(200);
    expect(enregistre.body.school.logoDataUrl).toBe(LOGO_PNG);
    const enBase = await prisma.school.findUniqueOrThrow({ where: { id: school.id } });
    expect(enBase.logoDataUrl).toBe(LOGO_PNG);

    const retire = await agent
      .patch(`/api/schools/${school.id}`)
      .set('x-csrf-token', csrf)
      .send({ logoDataUrl: null });

    expect(retire.status, JSON.stringify(retire.body)).toBe(200);
    expect(retire.body.school.logoDataUrl).toBeNull();
    expect(
      (await prisma.school.findUniqueOrThrow({ where: { id: school.id } })).logoDataUrl,
    ).toBeNull();
  });

  it('refuse un logo SVG ou un faux data URL', async () => {
    const school = await createSchool('École logo invalide');
    await createUser({
      email: 'logo-invalide@ecole.sn',
      password: 'MotDePasse123456',
      role: 'SCHOOL_ADMIN',
      schoolId: school.id,
    });

    const { csrf, agent } = await loginAs('logo-invalide@ecole.sn', 'MotDePasse123456');
    for (const logoDataUrl of [
      'data:image/svg+xml;base64,PHN2Zy8+',
      'data:text/html;base64,PHNjcmlwdC8+',
      'https://exemple.sn/logo.png',
    ]) {
      const res = await agent
        .patch(`/api/schools/${school.id}`)
        .set('x-csrf-token', csrf)
        .send({ logoDataUrl });
      expect(res.status, logoDataUrl).toBe(400);
    }

    expect(
      (await prisma.school.findUniqueOrThrow({ where: { id: school.id } })).logoDataUrl,
    ).toBeNull();
  });
});
