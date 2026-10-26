/**
 * Tests d'intégration HTTP de la phase 5 — API des bulletins et des bilans annuels.
 *
 * Le service est déjà testé en direct (tests/bulletins.test.ts) ; ici on vérifie la
 * surface exposée : garde d'authentification, jeton CSRF, rôles, publication et
 * correction versionnées, comparaison des semestres rendue par le serveur, flux PDF,
 * et isolation entre établissements.
 */
import request from 'supertest';
import http from 'node:http';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/db/prisma';
import { cleanTestDb, createSchool, createUser } from './helpers';
import { creerContexte, creerScenarioSemestres, type Contexte } from './aide-bulletins';

const PASSWORD = 'MotDePasse123456';

type Agent = request.Agent;

/** Serveur partagé : voir l'explication dans tests/notes.test.ts. */
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

/** Le corps binaire d'un flux PDF, sous la forme que supertest nous laisse. */
function octets(res: request.Response): Buffer {
  if (Buffer.isBuffer(res.body) && res.body.length > 0) return res.body;
  return Buffer.from(res.text ?? '', 'binary');
}

function assertFluxPdf(res: request.Response): Buffer {
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toContain('application/pdf');
  expect(res.headers['content-disposition']).toContain('attachment; filename=');
  const corps = octets(res);
  expect(corps.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(corps.subarray(-6).toString('latin1')).toContain('%%EOF');
  return corps;
}

describe('Phase 5 — API des bulletins', () => {
  let ctx: Contexte;
  let agent: Agent;

  beforeEach(async () => {
    await cleanTestDb();
    const school = await createSchool('Lycée de Touba Toul');
    const admin = await createUser({ email: 'admin@bulletins.sn', role: 'SCHOOL_ADMIN', schoolId: school.id });
    ctx = await creerContexte(school.id, admin.id);
    await creerScenarioSemestres(ctx);
    agent = await loginAs('admin@bulletins.sn');
  });

  async function generer(enrollmentId = ctx.eleves[0].enrollmentId, semesterId = ctx.semestre1Id) {
    const res = await agent
      .post('/api/report-cards/generate')
      .set('x-csrf-token', await csrf(agent))
      .send({ enrollmentId, semesterId });
    expect(res.status).toBeLessThan(300);
    return res.body.bulletin as { id: string; version: number; moyenneGeneraleExacte: string };
  }

  it('refuse toute l’API sans session', async () => {
    const sans = request(await serveurEcoute());
    const liste = await sans.get('/api/report-cards').query({
      classroomId: ctx.classroomId,
      semesterId: ctx.semestre1Id,
    });
    expect(liste.status).toBe(401);
    const detail = await sans.get('/api/report-cards/quelconque');
    expect(detail.status).toBe(401);
    const ecrit = await sans.post('/api/report-cards/generate').send({
      enrollmentId: ctx.eleves[0].enrollmentId,
      semesterId: ctx.semestre1Id,
    });
    expect(ecrit.status).toBe(401);
  });

  it('exige le jeton CSRF et un rôle habilité pour écrire', async () => {
    const sansJeton = await agent.post('/api/report-cards/generate').send({
      enrollmentId: ctx.eleves[0].enrollmentId,
      semesterId: ctx.semestre1Id,
    });
    expect(sansJeton.status).toBe(403);
    expect(sansJeton.body.error).toMatch(/CSRF/);

    await createUser({ email: 'assistant@bulletins.sn', role: 'ASSISTANT', schoolId: ctx.schoolId });
    const assistant = await loginAs('assistant@bulletins.sn');

    const lecture = await assistant.get('/api/report-cards').query({
      classroomId: ctx.classroomId,
      semesterId: ctx.semestre1Id,
    });
    expect(lecture.status).toBe(200);

    const ecriture = await assistant
      .post('/api/report-cards/generate')
      .set('x-csrf-token', await csrf(assistant))
      .send({ enrollmentId: ctx.eleves[0].enrollmentId, semesterId: ctx.semestre1Id });
    expect(ecriture.status).toBe(403);
    expect(ecriture.body.error).toMatch(/administrateur/i);
    expect(await prisma.reportCard.count({ where: { schoolId: ctx.schoolId } })).toBe(0);
  });

  it('valide les paramètres et refuse un bulletin inexistant', async () => {
    const sansSemestre = await agent.get('/api/report-cards').query({ classroomId: ctx.classroomId });
    expect(sansSemestre.status).toBe(400);

    const inconnu = await agent.get('/api/report-cards/inexistant');
    expect(inconnu.status).toBe(404);

    const corps = await agent
      .post('/api/report-cards/generate')
      .set('x-csrf-token', await csrf(agent))
      .send({ enrollmentId: ctx.eleves[0].enrollmentId });
    expect(corps.status).toBe(400);
    expect(corps.body.error).toBe('Données invalides');
  });

  it('génère, liste, publie puis fige le bulletin', async () => {
    const bulletin = await generer();
    expect(bulletin.version).toBe(1);
    expect(bulletin.moyenneGeneraleExacte).toBe('15.2');

    const liste = await agent
      .get('/api/report-cards')
      .query({ classroomId: ctx.classroomId, semesterId: ctx.semestre1Id });
    expect(liste.status).toBe(200);
    expect(liste.body.semestre.numero).toBe(1);
    expect(liste.body.lignes).toHaveLength(4);
    expect(liste.body.lignes.filter((l: { bulletin: unknown }) => l.bulletin !== null)).toHaveLength(1);
    // aucune donnée manquante n'est masquée : les trois autres lignes sont null, pas zéro
    expect(liste.body.lignes[3].bulletin).toBeNull();

    const detail = await agent.get(`/api/report-cards/${bulletin.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.snapshot.synthese.moyenneGeneraleAffichee).toBe('15.20');
    expect(detail.body.snapshot.eleve.nom).toBe('Alpha');
    expect(detail.body.historique).toHaveLength(1);

    const publie = await agent
      .post('/api/report-cards/publish')
      .set('x-csrf-token', await csrf(agent))
      .send({ ids: [bulletin.id] });
    expect(publie.status).toBe(200);
    expect(publie.body).toEqual({ publies: 1, dejaPublies: 0 });

    const regeneration = await agent
      .post('/api/report-cards/generate')
      .set('x-csrf-token', await csrf(agent))
      .send({ enrollmentId: ctx.eleves[0].enrollmentId, semesterId: ctx.semestre1Id });
    expect(regeneration.status).toBe(409);
    expect(regeneration.body.error).toMatch(/figé/);

    const texteApresPublication = await agent
      .patch(`/api/report-cards/${bulletin.id}`)
      .set('x-csrf-token', await csrf(agent))
      .send({ mention: 'Félicitations' });
    expect(texteApresPublication.status).toBe(409);
  });

  it('corrige un bulletin publié en version 2 et conserve la version 1', async () => {
    const bulletin = await generer();
    await agent.post('/api/report-cards/publish').set('x-csrf-token', await csrf(agent)).send({ ids: [bulletin.id] });

    const sansMotif = await agent
      .post(`/api/report-cards/${bulletin.id}/correct`)
      .set('x-csrf-token', await csrf(agent))
      .send({ motif: 'ab' });
    expect(sansMotif.status).toBe(400);

    // une note relevée entre en compte dans la nouvelle version
    const devoir = await prisma.assessment.findFirstOrThrow({ where: { title: 'Devoir 1 Maths S1' } });
    await prisma.grade.update({
      where: { assessmentId_enrollmentId: { assessmentId: devoir.id, enrollmentId: ctx.eleves[0].enrollmentId } },
      data: { score: new Prisma.Decimal('20') },
    });

    const correction = await agent
      .post(`/api/report-cards/${bulletin.id}/correct`)
      .set('x-csrf-token', await csrf(agent))
      .send({ motif: 'Note de devoir relevée après vérification' });
    expect(correction.status).toBe(201);
    expect(correction.body.bulletin.version).toBe(2);
    expect(correction.body.bulletin.moyenneGeneraleExacte).toBe('16.4');
    expect(correction.body.bulletin.motifCorrection).toBe('Note de devoir relevée après vérification');

    const detail = await agent.get(`/api/report-cards/${bulletin.id}`);
    expect(detail.body.bulletin.estCourant).toBe(false);
    expect(detail.body.bulletin.moyenneGeneraleExacte).toBe('15.2');
    const historique = await agent.get(`/api/report-cards/${correction.body.bulletin.id}`);
    expect(historique.body.historique.map((v: { version: number }) => v.version)).toEqual([2, 1]);

    const journal = await prisma.auditLog.findFirst({
      where: { schoolId: ctx.schoolId, action: 'REPORT_CARD_CORRECTED' },
    });
    expect(journal?.entityId).toBe(correction.body.bulletin.id);
  });

  it('accepte les champs libres avant publication et les reporte au recalcul', async () => {
    const bulletin = await generer();
    const snapshot = (await agent.get(`/api/report-cards/${bulletin.id}`)).body.snapshot;
    const subjectId = snapshot.matieres[0].subjectId as string;

    const maj = await agent
      .patch(`/api/report-cards/${bulletin.id}`)
      .set('x-csrf-token', await csrf(agent))
      .send({
        mention: 'Félicitations',
        appreciationsParMatiere: [{ subjectId, appreciation: 'Très bon trimestre.' }],
      });
    expect(maj.status).toBe(200);
    expect(maj.body.bulletin.mention).toBe('Félicitations');

    const apresRecalcul = await generer();
    const relu = await agent.get(`/api/report-cards/${apresRecalcul.id}`);
    expect(relu.body.snapshot.matieres[0].appreciation).toBe('Très bon trimestre.');
    expect(relu.body.bulletin.mention).toBe('Félicitations');

    const matiereInconnue = await agent
      .patch(`/api/report-cards/${bulletin.id}`)
      .set('x-csrf-token', await csrf(agent))
      .send({ appreciationsParMatiere: [{ subjectId: 'hors-bulletin', appreciation: 'x' }] });
    expect(matiereInconnue.status).toBe(400);
  });

  it('compare les deux semestres à partir des snapshots, écarts calculés serveur', async () => {
    await generer(ctx.eleves[0].enrollmentId, ctx.semestre1Id);
    await generer(ctx.eleves[0].enrollmentId, ctx.semestre2Id);

    const comparaison = await agent
      .get('/api/report-cards/comparaison')
      .query({ enrollmentId: ctx.eleves[0].enrollmentId, academicYearId: ctx.academicYearId });
    expect(comparaison.status).toBe(200);
    expect(comparaison.body.semestres.map((s: { numero: number }) => s.numero)).toEqual([1, 2]);
    expect(comparaison.body.semestres[0].moyenneGeneraleAffichee).toBe('15.20');
    expect(comparaison.body.semestres[1].moyenneGeneraleAffichee).toBe('18.20');
    // 18,20 - 15,20 = 3,00 : le serveur fait la soustraction, pas l'interface
    expect(comparaison.body.generale.ecart).toBe('3');
    expect(comparaison.body.generale.ecartAffiche).toBe('3.00');
    expect(comparaison.body.generale.motif).toBeNull();

    const maths = comparaison.body.matieres.find((m: { subjectName: string }) => m.subjectName === 'Mathématiques');
    expect(maths.s1).toBe('16');
    expect(maths.s2).toBe('19');
    expect(maths.ecartAffiche).toBe('3.00');

    // sans bulletin de S2, l'écart est signalé comme non calculable : jamais comblé
    const autre = await agent
      .get('/api/report-cards/comparaison')
      .query({ enrollmentId: ctx.eleves[1].enrollmentId, academicYearId: ctx.academicYearId });
    expect(autre.status).toBe(200);
    expect(autre.body.semestres[0].reportCardId).toBeNull();
    expect(autre.body.generale.ecart).toBeNull();
    expect(autre.body.generale.motif).toMatch(/aucun semestre comparé/);
  });

  it('rend un PDF A4 par bulletin et un seul PDF pour toute la classe', async () => {
    const bulletin = await generer();

    const unitaire = assertFluxPdf(await agent.get(`/api/report-cards/${bulletin.id}/pdf`));
    expect(unitaire.length).toBeGreaterThan(1000);

    const lot = await agent
      .post('/api/report-cards/generate-class')
      .set('x-csrf-token', await csrf(agent))
      .send({ classroomId: ctx.classroomId, semesterId: ctx.semestre1Id });
    expect(lot.status).toBe(200);
    expect(lot.body.generes).toBe(3);
    expect(lot.body.ignores).toEqual([]);

    const impression = await agent
      .get('/api/report-cards/pdf')
      .query({ classroomId: ctx.classroomId, semesterId: ctx.semestre1Id });
    assertFluxPdf(impression);
    expect(impression.headers['x-contenu-pages']).toBe('4');

    const parIds = await agent.get('/api/report-cards/pdf').query({ ids: bulletin.id });
    assertFluxPdf(parIds);
    expect(parIds.headers['x-contenu-pages']).toBe('1');

    const vide = await agent.get('/api/report-cards/pdf').query({});
    expect(vide.status).toBe(400);
  });

  it('génère, publie et imprime le bilan annuel ; le gel protège le document', async () => {
    await generer(ctx.eleves[0].enrollmentId, ctx.semestre1Id);
    await generer(ctx.eleves[0].enrollmentId, ctx.semestre2Id);

    const bilan = await agent
      .post('/api/annual-summaries/generate')
      .set('x-csrf-token', await csrf(agent))
      .send({ enrollmentId: ctx.eleves[0].enrollmentId, academicYearId: ctx.academicYearId });
    expect(bilan.status).toBe(201);
    expect(bilan.body.bilan.moyenneAnnuelleExacte).toBe('16.7');
    expect(bilan.body.bilan.calculable).toBe(true);
    expect(bilan.body.bilan.rangAnnuel).toBe(1);
    expect(bilan.body.bilan.s1ReportCardId).not.toBeNull();
    expect(bilan.body.bilan.s2ReportCardId).not.toBeNull();

    const liste = await agent
      .get('/api/annual-summaries')
      .query({ classroomId: ctx.classroomId, academicYearId: ctx.academicYearId });
    expect(liste.status).toBe(200);
    expect(liste.body.lignes).toHaveLength(4);
    expect(liste.body.lignes.filter((l: { bilan: unknown }) => l.bilan !== null)).toHaveLength(1);

    const detail = await agent.get(`/api/annual-summaries/${bilan.body.bilan.id}`);
    expect(detail.body.snapshot.annuelle.moyenne).toBe('16.7');
    expect(detail.body.snapshot.semestres[1].moyenneGeneraleAffichee).toBe('18.20');

    assertFluxPdf(await agent.get(`/api/annual-summaries/${bilan.body.bilan.id}/pdf`));

    const publie = await agent
      .post('/api/annual-summaries/publish')
      .set('x-csrf-token', await csrf(agent))
      .send({ ids: [bilan.body.bilan.id] });
    expect(publie.body).toEqual({ publies: 1, dejaPublies: 0 });

    const regenere = await agent
      .post('/api/annual-summaries/generate')
      .set('x-csrf-token', await csrf(agent))
      .send({ enrollmentId: ctx.eleves[0].enrollmentId, academicYearId: ctx.academicYearId });
    expect(regenere.status).toBe(409);
    expect(regenere.body.error).toMatch(/figé/);
  });

  it('refuse un bilan annuel quand l’année n’a pas ses deux semestres', async () => {
    const anneeIncomplete = await prisma.academicYear.create({
      data: {
        schoolId: ctx.schoolId,
        name: '2026-2027',
        startsAt: new Date('2026-10-01'),
        endsAt: new Date('2027-07-31'),
        status: 'ACTIVE',
        semesters: {
          create: [
            { number: 1, name: 'Semestre 1', startsAt: new Date('2026-10-01'), endsAt: new Date('2027-02-28') },
          ],
        },
      },
    });

    const bilan = await agent
      .post('/api/annual-summaries/generate')
      .set('x-csrf-token', await csrf(agent))
      .send({ enrollmentId: ctx.eleves[0].enrollmentId, academicYearId: anneeIncomplete.id });
    expect(bilan.status).toBe(422);
    expect(bilan.body.error).toMatch(/deux semestres/);
    expect(await prisma.annualSummary.count({ where: { schoolId: ctx.schoolId } })).toBe(0);
  });

  it('un établissement ne peut pas atteindre les bulletins d’un autre', async () => {
    const bulletin = await generer();

    const autre = await createSchool('Autre Lycée');
    await createUser({ email: 'admin@autre.sn', role: 'SCHOOL_ADMIN', schoolId: autre.id });
    const agentAutre = await loginAs('admin@autre.sn');

    const detail = await agentAutre.get(`/api/report-cards/${bulletin.id}`);
    expect(detail.status).toBe(404);

    const liste = await agentAutre
      .get('/api/report-cards')
      .query({ classroomId: ctx.classroomId, semesterId: ctx.semestre1Id });
    expect(liste.status).toBe(404);

    const pdf = await agentAutre.get(`/api/report-cards/${bulletin.id}/pdf`);
    expect(pdf.status).toBe(404);

    const publie = await agentAutre
      .post('/api/report-cards/publish')
      .set('x-csrf-token', await csrf(agentAutre))
      .send({ ids: [bulletin.id] });
    expect(publie.status).toBe(404);
    expect((await prisma.reportCard.findUniqueOrThrow({ where: { id: bulletin.id } })).statut).toBe('BOUILLON');
  });

  it('intègre absences et retards aux snapshots semestriel et annuel et conserve leur historique', async () => {
    const enrollmentId = ctx.eleves[0].enrollmentId;
    const absence = await agent
      .post('/api/school-life/attendance')
      .set('x-csrf-token', await csrf(agent))
      .send({
        enrollmentId,
        semesterId: ctx.semestre1Id,
        kind: 'ABSENCE',
        date: '2025-10-20',
        justified: true,
        reason: 'Certificat médical',
      });
    expect(absence.status).toBe(201);

    const retard = await agent
      .post('/api/school-life/attendance')
      .set('x-csrf-token', await csrf(agent))
      .send({
        enrollmentId,
        semesterId: ctx.semestre1Id,
        kind: 'RETARD',
        date: '2025-10-21',
        durationMinutes: 12,
      });
    expect(retard.status).toBe(201);

    const invalidDate = await agent
      .post('/api/school-life/attendance')
      .set('x-csrf-token', await csrf(agent))
      .send({
        enrollmentId,
        semesterId: ctx.semestre1Id,
        kind: 'ABSENCE',
        date: '2025-09-10',
      });
    expect(invalidDate.status).toBe(400);

    const maj = await agent
      .patch(`/api/school-life/attendance/${retard.body.record.id}`)
      .set('x-csrf-token', await csrf(agent))
      .send({ durationMinutes: 15 });
    expect(maj.status).toBe(200);

    const bulletin = await generer(enrollmentId, ctx.semestre1Id);
    const detail = await agent.get(`/api/report-cards/${bulletin.id}`);
    expect(detail.body.snapshot.absences).toMatchObject({
      absencesJustifiees: 1,
      absencesNonJustifiees: 0,
      absencesTotal: 1,
      retards: 1,
      minutesRetard: 15,
    });

    const bilan = await agent
      .post('/api/annual-summaries/generate')
      .set('x-csrf-token', await csrf(agent))
      .send({ enrollmentId, academicYearId: ctx.academicYearId });
    expect(bilan.status).toBe(201);
    const bilanDetail = await agent.get(`/api/annual-summaries/${bilan.body.bilan.id}`);
    expect(bilanDetail.body.snapshot.absences.absencesTotal).toBe(1);

    const history = await agent.get('/api/school-life/history').query({
      entityType: 'AttendanceRecord',
      entityId: retard.body.record.id,
    });
    expect(history.status).toBe(200);
    expect(history.body.history.map((entry: { action: string }) => entry.action)).toContain('ATTENDANCE_UPDATED');
  });

  it('synchronise les appréciations, valide les décisions avant publication et archive les années closes', async () => {
    const enrollmentId = ctx.eleves[0].enrollmentId;
    const bulletin = await generer(enrollmentId, ctx.semestre1Id);
    const subject = await prisma.classroomSubject.findUniqueOrThrow({ where: { id: ctx.mathsCsf } });
    const appreciation = await agent
      .put('/api/school-life/appreciations')
      .set('x-csrf-token', await csrf(agent))
      .send({
        enrollmentId,
        semesterId: ctx.semestre1Id,
        subjectId: subject.subjectId,
        content: 'Très bons progrès.',
      });
    expect(appreciation.status).toBe(200);
    const detail = await agent.get(`/api/report-cards/${bulletin.id}`);
    expect(
      detail.body.snapshot.matieres.find((matiere: { subjectId: string }) => matiere.subjectId === subject.subjectId)
        .appreciation
    ).toBe('Très bons progrès.');
    await generer(enrollmentId, ctx.semestre1Id);
    const regenerate = await agent.get(`/api/report-cards/${bulletin.id}`);
    expect(
      regenerate.body.snapshot.matieres.find((matiere: { subjectId: string }) => matiere.subjectId === subject.subjectId)
        .appreciation
    ).toBe('Très bons progrès.');
    const clearAppreciation = await agent
      .put('/api/school-life/appreciations')
      .set('x-csrf-token', await csrf(agent))
      .send({
        enrollmentId,
        semesterId: ctx.semestre1Id,
        subjectId: subject.subjectId,
        content: '',
      });
    expect(clearAppreciation.status).toBe(200);
    await generer(enrollmentId, ctx.semestre1Id);
    const cleared = await agent.get(`/api/report-cards/${bulletin.id}`);
    expect(
      cleared.body.snapshot.matieres.find((matiere: { subjectId: string }) => matiere.subjectId === subject.subjectId)
        .appreciation
    ).toBeNull();

    const decision = await agent
      .post('/api/school-life/council-decisions')
      .set('x-csrf-token', await csrf(agent))
      .send({
        enrollmentId,
        academicYearId: ctx.academicYearId,
        content: 'Admis en classe supérieure',
      });
    expect(decision.status).toBe(201);
    expect(decision.body.decision.status).toBe('BROUILLON');

    const bilan = await agent
      .post('/api/annual-summaries/generate')
      .set('x-csrf-token', await csrf(agent))
      .send({ enrollmentId, academicYearId: ctx.academicYearId });
    expect(bilan.status).toBe(201);
    const tentativeDecision = await agent
      .patch(`/api/report-cards/${bulletin.id}`)
      .set('x-csrf-token', await csrf(agent))
      .send({ decisionConseil: 'Admis en classe supérieure' });
    expect(tentativeDecision.status).toBe(400);
    expect((await agent.get(`/api/annual-summaries/${bilan.body.bilan.id}`)).body.snapshot.decisionConseil).toBeNull();

    const validation = await agent
      .post(`/api/school-life/council-decisions/${decision.body.decision.id}/validate`)
      .set('x-csrf-token', await csrf(agent));
    expect(validation.status).toBe(200);
    expect(validation.body.decision.status).toBe('VALIDEE');
    const bilanApresValidation = await agent.get(`/api/annual-summaries/${bilan.body.bilan.id}`);
    expect(bilanApresValidation.body.snapshot.decisionConseil).toBe('Admis en classe supérieure');
    expect(bilanApresValidation.body.snapshot.decisionConseilValideeLe).toBeTruthy();
    const champsBilan = await agent
      .patch(`/api/annual-summaries/${bilan.body.bilan.id}`)
      .set('x-csrf-token', await csrf(agent))
      .send({ mention: 'Félicitations', appreciation: 'Une année remarquable.' });
    expect(champsBilan.status).toBe(200);
    expect(champsBilan.body.snapshot.mention).toBe('Félicitations');
    expect(champsBilan.body.snapshot.decisionConseil).toBe('Admis en classe supérieure');

    await prisma.academicYear.update({
      where: { id: ctx.academicYearId },
      data: { status: 'CLOSED' },
    });
    const archives = await agent.get('/api/school-life/archives').query({
      academicYearId: ctx.academicYearId,
    });
    expect(archives.status).toBe(200);
    expect(archives.body.bulletins.some((card: { id: string }) => card.id === bulletin.id)).toBe(true);
    expect(archives.body.bilansAnnuels.some((summary: { id: string }) => summary.id === bilan.body.bilan.id)).toBe(true);
    expect(archives.body.decisionsConseil.some((row: { id: string }) => row.id === decision.body.decision.id)).toBe(true);

    const decisionHistory = await agent.get('/api/school-life/history').query({
      entityType: 'CouncilDecision',
      entityId: decision.body.decision.id,
    });
    expect(decisionHistory.body.history.map((entry: { action: string }) => entry.action)).toContain(
      'COUNCIL_DECISION_VALIDATED'
    );
  });
});
