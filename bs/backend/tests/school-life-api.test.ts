import request from 'supertest';
import http from 'node:http';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/db/prisma';
import { cleanTestDb, createSchool, createUser } from './helpers';
import { creerContexte, creerScenarioSemestres, type Contexte } from './aide-bulletins';

const PASSWORD = 'MotDePasse123456';

type Agent = request.Agent;

let serveur: http.Server | null = null;

async function serveurEcoute(): Promise<http.Server> {
  if (!serveur) {
    serveur = http.createServer(app);
    await new Promise<void>((resolve) => {
      serveur!.listen(0, '127.0.0.1', resolve);
    });
  }
  return serveur;
}

afterAll(async () => {
  if (!serveur) return;
  serveur.closeAllConnections();
  await new Promise<void>((resolve) => {
    serveur!.close(() => resolve());
  });
  serveur = null;
});

async function loginAs(email: string): Promise<Agent> {
  const agent = request.agent(await serveurEcoute());
  const session = await agent.get('/api/auth/session');
  const login = await agent
    .post('/api/auth/login')
    .set('x-csrf-token', session.body.csrfToken)
    .send({ email, password: PASSWORD });
  if (login.status !== 200) {
    throw new Error(`Connexion impossible pour ${email} : HTTP ${login.status} ${JSON.stringify(login.body)}`);
  }
  return agent;
}

async function csrf(agent: Agent): Promise<string> {
  const session = await agent.get('/api/auth/session');
  return session.body.csrfToken as string;
}

describe('Phase 6 — API de la vie scolaire', () => {
  let ctx: Contexte;
  let admin: Agent;
  let adminEmail: string;

  beforeEach(async () => {
    await cleanTestDb();
    const school = await createSchool('Lycée de Thiès');
    adminEmail = 'admin@viescolaire.sn';
    const adminUser = await createUser({
      email: adminEmail,
      role: 'SCHOOL_ADMIN',
      schoolId: school.id,
      name: 'Administrateur Vie Scolaire',
    });
    await createUser({
      email: 'surveillant@viescolaire.sn',
      role: 'SURVEILLANT_GENERAL',
      schoolId: school.id,
      name: 'Surveillant Général',
    });
    ctx = await creerContexte(school.id, adminUser.id);
    await creerScenarioSemestres(ctx);
    admin = await loginAs(adminEmail);
  });

  function auth(agent: Agent) {
    return csrf(agent).then((token) => ({ 'x-csrf-token': token }));
  }

  async function creerAbsence(agent: Agent = admin) {
    const res = await agent
      .post('/api/school-life/attendance')
      .set(await auth(agent))
      .send({
        enrollmentId: ctx.eleves[0].enrollmentId,
        semesterId: ctx.semestre1Id,
        date: '2025-11-10',
        kind: 'ABSENCE',
        justified: true,
        reason: 'Maladie',
      });
    expect(res.status).toBe(201);
    return res.body.record as { id: string };
  }

  async function genererBulletin(enrollmentId: string, semesterId: string) {
    const res = await admin
      .post('/api/report-cards/generate')
      .set(await auth(admin))
      .send({ enrollmentId, semesterId });
    expect(res.status).toBeLessThan(300);
    return res.body.bulletin as { id: string };
  }

  async function genererBilan(enrollmentId: string) {
    const res = await admin
      .post('/api/annual-summaries/generate')
      .set(await auth(admin))
      .send({ enrollmentId, academicYearId: ctx.academicYearId });
    expect(res.status).toBeLessThan(300);
    return res.body.bilan as { id: string };
  }

  it('refuse l’API sans session et les écritures sans jeton CSRF', async () => {
    const anonyme = request(await serveurEcoute());
    expect((await anonyme.get('/api/school-life/attendance')).status).toBe(401);

    const res = await admin.post('/api/school-life/attendance').send({
      enrollmentId: ctx.eleves[0].enrollmentId,
      semesterId: ctx.semestre1Id,
      date: '2025-11-10',
      kind: 'ABSENCE',
      justified: false,
    });
    expect(res.status).toBe(403);
    expect(await prisma.attendanceRecord.count()).toBe(0);
  });

  it('enregistre absences et retards, les agrège puis conserve l’historique des corrections', async () => {
    const absence = await creerAbsence();
    const retard = await admin
      .post('/api/school-life/attendance')
      .set(await auth(admin))
      .send({
        enrollmentId: ctx.eleves[0].enrollmentId,
        semesterId: ctx.semestre1Id,
        date: '2025-11-11',
        kind: 'RETARD',
        justified: false,
        durationMinutes: 15,
        reason: 'Transport',
      });
    expect(retard.status).toBe(201);
    expect(retard.body.record.durationMinutes).toBe(15);

    const liste = await admin
      .get('/api/school-life/attendance')
      .query({ enrollmentId: ctx.eleves[0].enrollmentId, semesterId: ctx.semestre1Id });
    expect(liste.status).toBe(200);
    expect(liste.body.records).toHaveLength(2);
    expect(liste.body.resume).toMatchObject({
      absencesJustifiees: 1,
      absencesNonJustifiees: 0,
      absencesTotal: 1,
      retards: 1,
      minutesRetard: 15,
    });

    const modifie = await admin
      .patch(`/api/school-life/attendance/${retard.body.record.id}`)
      .set(await auth(admin))
      .send({ justified: true, durationMinutes: 20, reason: 'Transport retardé' });
    expect(modifie.status).toBe(200);
    expect(modifie.body.record).toMatchObject({ justified: true, durationMinutes: 20 });

    const supprime = await admin
      .delete(`/api/school-life/attendance/${absence.id}`)
      .set(await auth(admin));
    expect(supprime.status).toBe(200);
    expect(supprime.body.record.deletedAt).toBeTruthy();

    const apres = await admin
      .get('/api/school-life/attendance')
      .query({ enrollmentId: ctx.eleves[0].enrollmentId, semesterId: ctx.semestre1Id });
    expect(apres.body.records).toHaveLength(1);
    expect(apres.body.resume).toMatchObject({ absencesTotal: 0, retards: 1, minutesRetard: 20 });

    const historique = await admin
      .get('/api/school-life/history')
      .query({ entityType: 'AttendanceRecord', entityId: absence.id });
    expect(historique.status).toBe(200);
    expect(historique.body.history.map((ligne: { action: string }) => ligne.action)).toEqual(
      expect.arrayContaining(['ATTENDANCE_CREATED', 'ATTENDANCE_DELETED']),
    );
  });

  it('valide les événements de présence et les rattache au bon semestre', async () => {
    const dureeSurAbsence = await admin
      .post('/api/school-life/attendance')
      .set(await auth(admin))
      .send({
        enrollmentId: ctx.eleves[0].enrollmentId,
        semesterId: ctx.semestre1Id,
        date: '2025-11-10',
        kind: 'ABSENCE',
        justified: false,
        durationMinutes: 5,
      });
    expect(dureeSurAbsence.status).toBe(400);

    const horsSemestre = await admin
      .post('/api/school-life/attendance')
      .set(await auth(admin))
      .send({
        enrollmentId: ctx.eleves[0].enrollmentId,
        semesterId: ctx.semestre1Id,
        date: '2026-04-10',
        kind: 'ABSENCE',
        justified: false,
      });
    expect(horsSemestre.status).toBe(400);

    const autreSemestre = await admin
      .post('/api/school-life/attendance')
      .set(await auth(admin))
      .send({
        enrollmentId: ctx.eleves[0].enrollmentId,
        semesterId: ctx.semestre2Id,
        date: '2026-04-10',
        kind: 'ABSENCE',
        justified: false,
      });
    expect(autreSemestre.status).toBe(201);
  });

  it('synchronise les appréciations manuelles dans les bulletins brouillons', async () => {
    const bulletin = await genererBulletin(ctx.eleves[0].enrollmentId, ctx.semestre1Id);
    const maths = await prisma.subject.findFirstOrThrow({
      where: { schoolId: ctx.schoolId, code: 'MATH' },
    });

    const enregistree = await admin
      .put('/api/school-life/appreciations')
      .set(await auth(admin))
      .send({
        enrollmentId: ctx.eleves[0].enrollmentId,
        semesterId: ctx.semestre1Id,
        subjectId: maths.id,
        content: 'Excellent travail, poursuivez ainsi.',
      });
    expect(enregistree.status).toBe(200);
    expect(enregistree.body.appreciation).toMatchObject({ autoGenerated: false });

    const detail = await admin.get(`/api/report-cards/${bulletin.id}`);
    expect(detail.status).toBe(200);
    const matiere = detail.body.snapshot.matieres.find(
      (ligne: { subjectId: string }) => ligne.subjectId === maths.id,
    );
    expect(matiere).toMatchObject({
      appreciation: 'Excellent travail, poursuivez ainsi.',
      appreciationAuto: false,
    });

    const liste = await admin
      .get('/api/school-life/appreciations')
      .query({ enrollmentId: ctx.eleves[0].enrollmentId, semesterId: ctx.semestre1Id });
    expect(
      liste.body.appreciations.find((ligne: { subjectId: string }) => ligne.subjectId === maths.id),
    ).toMatchObject({
      content: 'Excellent travail, poursuivez ainsi.',
      autoGenerated: false,
    });

    const effacee = await admin
      .put('/api/school-life/appreciations')
      .set(await auth(admin))
      .send({
        enrollmentId: ctx.eleves[0].enrollmentId,
        semesterId: ctx.semestre1Id,
        subjectId: maths.id,
        content: '',
      });
    expect(effacee.status).toBe(200);
    expect(effacee.body.appreciation).toBeNull();

    const detailApres = await admin.get(`/api/report-cards/${bulletin.id}`);
    const matiereApres = detailApres.body.snapshot.matieres.find(
      (ligne: { subjectId: string }) => ligne.subjectId === maths.id,
    );
    expect(matiereApres.appreciation).toBeNull();

    const historique = await admin
      .get('/api/school-life/history')
      .query({ entityType: 'Appreciation', entityId: enregistree.body.appreciation.id });
    expect(historique.body.history.map((ligne: { action: string }) => ligne.action)).toEqual(
      expect.arrayContaining(['APPRECIATION_UPDATED', 'APPRECIATION_DELETED']),
    );
  });

  it('ne publie jamais une décision non validée et ne valide qu’en administrateur', async () => {
    await genererBulletin(ctx.eleves[0].enrollmentId, ctx.semestre1Id);
    await genererBulletin(ctx.eleves[0].enrollmentId, ctx.semestre2Id);
    const bilan = await genererBilan(ctx.eleves[0].enrollmentId);

    const creation = await admin
      .post('/api/school-life/council-decisions')
      .set(await auth(admin))
      .send({
        enrollmentId: ctx.eleves[0].enrollmentId,
        academicYearId: ctx.academicYearId,
        content: 'Admis en classe supérieure.',
      });
    expect(creation.status).toBe(201);
    expect(creation.body.decision).toMatchObject({ status: 'BROUILLON', version: 1, isCurrent: true });

    const avantValidation = await admin.get(`/api/annual-summaries/${bilan.id}`);
    expect(avantValidation.body.bilan.decisionConseil).toBeNull();
    expect(avantValidation.body.snapshot.decisionConseil).toBeNull();

    const surveillant = await loginAs('surveillant@viescolaire.sn');
    const refus = await surveillant
      .post(`/api/school-life/council-decisions/${creation.body.decision.id}/validate`)
      .set(await auth(surveillant));
    expect(refus.status).toBe(403);

    const validation = await admin
      .post(`/api/school-life/council-decisions/${creation.body.decision.id}/validate`)
      .set(await auth(admin));
    expect(validation.status).toBe(200);
    expect(validation.body.decision.status).toBe('VALIDEE');
    expect(validation.body.decision.validatedAt).toBeTruthy();

    const apresValidation = await admin.get(`/api/annual-summaries/${bilan.id}`);
    expect(apresValidation.body.bilan.decisionConseil).toBe('Admis en classe supérieure.');
    expect(apresValidation.body.bilan.decisionConseilValideeLe).toBeTruthy();

    const nouvelle = await admin
      .post('/api/school-life/council-decisions')
      .set(await auth(admin))
      .send({
        enrollmentId: ctx.eleves[0].enrollmentId,
        academicYearId: ctx.academicYearId,
        content: 'Admis avec mention.',
      });
    expect(nouvelle.status).toBe(201);
    expect(nouvelle.body.decision).toMatchObject({ status: 'BROUILLON', version: 2, isCurrent: true });

    const courantes = await admin
      .get('/api/school-life/council-decisions')
      .query({ academicYearId: ctx.academicYearId });
    expect(courantes.body.decisions).toHaveLength(1);
    expect(courantes.body.decisions[0].id).toBe(nouvelle.body.decision.id);

    const bilanInchange = await admin.get(`/api/annual-summaries/${bilan.id}`);
    expect(bilanInchange.body.bilan.decisionConseil).toBe('Admis en classe supérieure.');

    const validationNouvelle = await admin
      .post(`/api/school-life/council-decisions/${nouvelle.body.decision.id}/validate`)
      .set(await auth(admin));
    expect(validationNouvelle.status).toBe(200);

    const bilanMisAJour = await admin.get(`/api/annual-summaries/${bilan.id}`);
    expect(bilanMisAJour.body.bilan.decisionConseil).toBe('Admis avec mention.');

    const versionPrecedente = await prisma.councilDecision.findFirstOrThrow({
      where: { id: creation.body.decision.id },
    });
    expect(versionPrecedente.isCurrent).toBe(false);
    expect(versionPrecedente.status).toBe('VALIDEE');
  });

  it('refuse toute écriture de vie scolaire sur une année clôturée et expose l’archive', async () => {
    const absence = await creerAbsence();
    const maths = await prisma.subject.findFirstOrThrow({
      where: { schoolId: ctx.schoolId, code: 'MATH' },
    });
    const appreciation = await admin
      .put('/api/school-life/appreciations')
      .set(await auth(admin))
      .send({
        enrollmentId: ctx.eleves[0].enrollmentId,
        semesterId: ctx.semestre1Id,
        subjectId: maths.id,
        content: 'Bonne année.',
      });
    const decision = await admin
      .post('/api/school-life/council-decisions')
      .set(await auth(admin))
      .send({
        enrollmentId: ctx.eleves[0].enrollmentId,
        academicYearId: ctx.academicYearId,
        content: 'Décision archivée.',
      });

    await prisma.academicYear.update({
      where: { id: ctx.academicYearId },
      data: { status: 'CLOSED' },
    });

    const creation = await admin
      .post('/api/school-life/attendance')
      .set(await auth(admin))
      .send({
        enrollmentId: ctx.eleves[0].enrollmentId,
        semesterId: ctx.semestre1Id,
        date: '2025-11-12',
        kind: 'ABSENCE',
        justified: false,
      });
    expect(creation.status).toBe(409);

    const modification = await admin
      .patch(`/api/school-life/attendance/${absence.id}`)
      .set(await auth(admin))
      .send({ justified: false });
    expect(modification.status).toBe(409);

    const suppression = await admin
      .delete(`/api/school-life/appreciations/${appreciation.body.appreciation.id}`)
      .set(await auth(admin));
    expect(suppression.status).toBe(409);

    const appreciationModifiee = await admin
      .put('/api/school-life/appreciations')
      .set(await auth(admin))
      .send({
        enrollmentId: ctx.eleves[0].enrollmentId,
        semesterId: ctx.semestre1Id,
        subjectId: maths.id,
        content: 'Trop tard.',
      });
    expect(appreciationModifiee.status).toBe(409);

    const nouvelleDecision = await admin
      .post('/api/school-life/council-decisions')
      .set(await auth(admin))
      .send({
        enrollmentId: ctx.eleves[0].enrollmentId,
        academicYearId: ctx.academicYearId,
        content: 'Trop tard.',
      });
    expect(nouvelleDecision.status).toBe(409);

    const validation = await admin
      .post(`/api/school-life/council-decisions/${decision.body.decision.id}/validate`)
      .set(await auth(admin));
    expect(validation.status).toBe(409);

    const archive = await admin
      .get('/api/school-life/archives')
      .query({ academicYearId: ctx.academicYearId });
    expect(archive.status).toBe(200);
    expect(archive.body.annee.status).toBe('CLOSED');
    expect(archive.body.presences).toHaveLength(1);
    expect(archive.body.appreciations).toHaveLength(1);
    expect(archive.body.decisionsConseil).toHaveLength(1);
  });

  it('n’expose les archives que pour une année clôturée et isole les établissements', async () => {
    const nonCloturee = await admin
      .get('/api/school-life/archives')
      .query({ academicYearId: ctx.academicYearId });
    expect(nonCloturee.status).toBe(409);

    await prisma.academicYear.update({
      where: { id: ctx.academicYearId },
      data: { status: 'CLOSED' },
    });

    const autreEcole = await createSchool('Autre lycée');
    await createUser({ email: 'admin@autre.sn', role: 'SCHOOL_ADMIN', schoolId: autreEcole.id });
    const autreAdmin = await loginAs('admin@autre.sn');

    const archiveEtrangere = await autreAdmin
      .get('/api/school-life/archives')
      .query({ academicYearId: ctx.academicYearId });
    expect(archiveEtrangere.status).toBe(404);

    const absence = await prisma.attendanceRecord.create({
      data: {
        schoolId: ctx.schoolId,
        enrollmentId: ctx.eleves[0].enrollmentId,
        semesterId: ctx.semestre1Id,
        date: new Date('2025-11-10'),
        kind: 'ABSENCE',
        justified: false,
        recordedById: ctx.userId,
      },
    });

    const modificationEtrangere = await autreAdmin
      .patch(`/api/school-life/attendance/${absence.id}`)
      .set(await auth(autreAdmin))
      .send({ justified: true });
    expect(modificationEtrangere.status).toBe(404);

    const consultationEtrangere = await autreAdmin
      .get('/api/school-life/attendance')
      .query({ enrollmentId: ctx.eleves[0].enrollmentId, semesterId: ctx.semestre1Id });
    expect(consultationEtrangere.status).toBe(404);
  });
});
