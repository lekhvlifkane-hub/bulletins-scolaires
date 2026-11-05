/**
 * Tests d'intégration de la phase 4 — évaluations, notes, workflow et calculs.
 *
 * Ils complètent tests/calcul.test.ts (règles pures du moteur §10) en vérifiant
 * le comportement réel des endpoints : contrôles serveur, doublons, transitions
 * du workflow, permissions, isolation entre établissements et classement final.
 */
import request from 'supertest';
import http from 'node:http';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import type { GradeStatus } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/db/prisma';
import { cleanTestDb, createSchool, createUser } from './helpers';

const PASSWORD = 'MotDePasse123456';

type Agent = request.Agent;

/**
 * Serveur partagé, démarré une seule fois : supertest 7.x ouvre et referme
 * automatiquement le serveur qu'il crée lui-même, ce qui rend caduques les
 * requêtes suivantes du même agent (course sur la fermeture). Avec un serveur
 * déjà à l'écoute, l'agent ne gère plus aucun cycle de vie.
 */
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
    throw new Error(
      `Connexion de test impossible pour ${email} : HTTP ${login.status} ${JSON.stringify(login.body)}`
    );
  }
  return agent;
}

/** Jette un œil hors session (contrôle des garde d'authentification). */
async function sansSession() {
  return request(await serveurEcoute());
}

/** Jeton CSRF courant : le jeton peut tourner à la connexion, on le relit à chaque écriture. */
async function csrf(agent: Agent): Promise<string> {
  const session = await agent.get('/api/auth/session');
  return session.body.csrfToken as string;
}

interface Contexte {
  schoolId: string;
  academicYearId: string;
  semestre1Id: string;
  semestre2Id: string;
  classroomId: string;
  mathsCsf: string;
  histoireCsf: string;
  devoirTypeId: string;
  compositionTypeId: string;
  eleves: { enrollmentId: string; studentId: string; matricule: string }[];
}

async function creerContexte(schoolId: string, effectif = 4): Promise<Contexte> {
  const annee = await prisma.academicYear.create({
    data: {
      schoolId,
      name: '2025-2026',
      startsAt: new Date('2025-10-01'),
      endsAt: new Date('2026-07-31'),
      status: 'ACTIVE',
      semesters: {
        create: [
          {
            number: 1,
            name: 'Semestre 1',
            startsAt: new Date('2025-10-01'),
            endsAt: new Date('2026-02-28'),
          },
          {
            number: 2,
            name: 'Semestre 2',
            startsAt: new Date('2026-03-01'),
            endsAt: new Date('2026-07-31'),
          },
        ],
      },
    },
    include: { semesters: { orderBy: { number: 'asc' } } },
  });
  const [semestre1, semestre2] = annee.semesters;

  const niveau = await prisma.level.create({ data: { schoolId, name: 'Terminale S' } });
  const classe = await prisma.classroom.create({
    data: { schoolId, academicYearId: annee.id, levelId: niveau.id, name: 'TS 1' },
  });

  const maths = await prisma.subject.create({
    data: { schoolId, name: 'Mathématiques', code: 'MATH' },
  });
  const histoire = await prisma.subject.create({
    data: { schoolId, name: 'Histoire-Géographie', code: 'HIGE' },
  });
  const csMaths = await prisma.classroomSubject.create({
    data: {
      schoolId,
      classroomId: classe.id,
      subjectId: maths.id,
      coefficient: new Prisma.Decimal('3'),
    },
  });
  const csHistoire = await prisma.classroomSubject.create({
    data: {
      schoolId,
      classroomId: classe.id,
      subjectId: histoire.id,
      coefficient: new Prisma.Decimal('2'),
    },
  });

  const eleves: Contexte['eleves'] = [];
  const prenoms = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
  for (let i = 0; i < effectif; i += 1) {
    const student = await prisma.student.create({
      data: {
        schoolId,
        matricule: `ELV-${i + 1}`,
        lastName: prenoms[i],
        firstNames: 'Eleve',
      },
    });
    const enrollment = await prisma.enrollment.create({
      data: { schoolId, studentId: student.id, classroomId: classe.id, status: 'ACTIVE' },
    });
    eleves.push({ enrollmentId: enrollment.id, studentId: student.id, matricule: student.matricule });
  }

  const devoir = await prisma.assessmentType.create({
    data: { schoolId, code: 'DEV', name: 'Devoir surveillé', category: 'DEVOIR' },
  });
  const composition = await prisma.assessmentType.create({
    data: { schoolId, code: 'COMP', name: 'Composition', category: 'COMPOSITION' },
  });

  return {
    schoolId,
    academicYearId: annee.id,
    semestre1Id: semestre1.id,
    semestre2Id: semestre2.id,
    classroomId: classe.id,
    mathsCsf: csMaths.id,
    histoireCsf: csHistoire.id,
    devoirTypeId: devoir.id,
    compositionTypeId: composition.id,
    eleves,
  };
}

/** Écriture directe en base : sert à préparer des évaluations déjà validées pour le calcul. */
async function evalValidee(
  ctx: Contexte,
  options: {
    classroomSubjectId: string;
    semesterId: string;
    typeId: string;
    title: string;
    position?: number;
    status?: 'BOUILLON' | 'SAISIE_EN_COURS' | 'A_VERIFIER' | 'VALIDEE' | 'PUBLIEE';
    notes: { enrollmentId: string; score: string | number | null; status?: GradeStatus }[];
  }
) {
  const assessment = await prisma.assessment.create({
    data: {
      schoolId: ctx.schoolId,
      classroomSubjectId: options.classroomSubjectId,
      semesterId: options.semesterId,
      typeId: options.typeId,
      title: options.title,
      position: options.position ?? 1,
      outOf: new Prisma.Decimal('20'),
      status: options.status ?? 'VALIDEE',
    },
  });
  for (const note of options.notes) {
    await prisma.grade.create({
      data: {
        schoolId: ctx.schoolId,
        assessmentId: assessment.id,
        enrollmentId: note.enrollmentId,
        score: note.score === null ? null : new Prisma.Decimal(String(note.score)),
        status: note.status ?? 'SAISIE',
      },
    });
  }
  return assessment;
}

/**
 * Scénario de calcul S1 (poids établissement : devoirs 1, compositions 1) :
 *   Alpha  maths (16,16)=16   histoire (14,14)=14  -> (16*3 + 14*2)/5 = 15,2  rang 1
 *   Beta   maths (14,14)=14   histoire (16,16)=16  -> (14*3 + 16*2)/5 = 14,8  rang 2
 *   Gamma  maths (13,15)=14   histoire (17,15)=16  -> 14,8                    rang 2 (ex aequo)
 *   Delta  maths (10,12)=11   histoire (10,10)=10  -> 10,6                    rang 4
 */
async function creerScenarioCalcul(ctx: Contexte) {
  const [alpha, beta, gamma, delta] = ctx.eleves;
  const n = (idx: number) => ctx.eleves[idx].enrollmentId;

  await evalValidee(ctx, {
    classroomSubjectId: ctx.mathsCsf,
    semesterId: ctx.semestre1Id,
    typeId: ctx.devoirTypeId,
    title: 'Devoir 1 Maths',
    notes: [
      { enrollmentId: n(0), score: 16 },
      { enrollmentId: n(1), score: 14 },
      { enrollmentId: n(2), score: 13 },
      { enrollmentId: n(3), score: 10 },
    ],
  });
  await evalValidee(ctx, {
    classroomSubjectId: ctx.mathsCsf,
    semesterId: ctx.semestre1Id,
    typeId: ctx.compositionTypeId,
    title: 'Composition Maths',
    position: 1,
    notes: [
      { enrollmentId: n(0), score: 16 },
      { enrollmentId: n(1), score: 14 },
      { enrollmentId: n(2), score: 15 },
      { enrollmentId: n(3), score: 12 },
    ],
  });
  await evalValidee(ctx, {
    classroomSubjectId: ctx.histoireCsf,
    semesterId: ctx.semestre1Id,
    typeId: ctx.devoirTypeId,
    title: 'Devoir 1 Histoire',
    notes: [
      { enrollmentId: n(0), score: 14 },
      { enrollmentId: n(1), score: 16 },
      { enrollmentId: n(2), score: 17 },
      { enrollmentId: n(3), score: 10 },
    ],
  });
  await evalValidee(ctx, {
    classroomSubjectId: ctx.histoireCsf,
    semesterId: ctx.semestre1Id,
    typeId: ctx.compositionTypeId,
    title: 'Composition Histoire',
    notes: [
      { enrollmentId: n(0), score: 14 },
      { enrollmentId: n(1), score: 16 },
      { enrollmentId: n(2), score: 15 },
      { enrollmentId: n(3), score: 10 },
    ],
  });

  return { alpha, beta, gamma, delta };
}

describe('Phase 4 — types et évaluations', () => {
  let ctx: Contexte;
  let agent: Agent;

  beforeEach(async () => {
    await cleanTestDb();
    const school = await createSchool('Lycée Alpha');
    await createUser({ email: 'admin@alpha.sn', role: 'SCHOOL_ADMIN', schoolId: school.id });
    ctx = await creerContexte(school.id);
    agent = await loginAs('admin@alpha.sn');
  });

  it('refuse un code de type déjà utilisé (doublon)', async () => {
    const res = await agent
      .post('/api/assessment-types')
      .set('x-csrf-token', await csrf(agent))
      .send({ code: 'DEV', name: 'Devoir bis', category: 'DEVOIR' });

    expect(res.status).toBe(409);
  });

  it('crée un nouveau type d\'évaluation', async () => {
    const res = await agent
      .post('/api/assessment-types')
      .set('x-csrf-token', await csrf(agent))
      .send({ code: 'ORAL', name: 'Oral', category: 'AUTRE', defaultOutOf: 10 });

    expect(res.status).toBe(201);
    expect(res.body.type.category).toBe('AUTRE');
    expect(res.body.type.defaultOutOf).toBe('10');
  });

  it('numérote automatiquement la position et refuse le doublon classe/semestre/type/position', async () => {
    const premiere = await agent
      .post('/api/assessments')
      .set('x-csrf-token', await csrf(agent))
      .send({
        classroomSubjectId: ctx.mathsCsf,
        semesterId: ctx.semestre1Id,
        typeId: ctx.devoirTypeId,
        title: 'Devoir 1 Maths',
      });

    expect(premiere.status).toBe(201);
    expect(premiere.body.assessment.position).toBe(1);
    expect(premiere.body.assessment.status).toBe('BOUILLON');
    expect(premiere.body.assessment.outOf).toBe('20');

    const doublon = await agent
      .post('/api/assessments')
      .set('x-csrf-token', await csrf(agent))
      .send({
        classroomSubjectId: ctx.mathsCsf,
        semesterId: ctx.semestre1Id,
        typeId: ctx.devoirTypeId,
        title: 'Devoir 1 Maths bis',
        position: 1,
      });

    expect(doublon.status).toBe(409);
    expect(doublon.body.error).toContain('doublon');

    const suivante = await agent
      .post('/api/assessments')
      .set('x-csrf-token', await csrf(agent))
      .send({
        classroomSubjectId: ctx.mathsCsf,
        semesterId: ctx.semestre1Id,
        typeId: ctx.devoirTypeId,
        title: 'Devoir 2 Maths',
      });
    expect(suivante.status).toBe(201);
    expect(suivante.body.assessment.position).toBe(2);
  });

  it('refuse une évaluation rattachée à une classe d\'un autre établissement', async () => {
    const res = await agent
      .post('/api/assessments')
      .set('x-csrf-token', await csrf(agent))
      .send({
        classroomSubjectId: 'cs-inexistant',
        semesterId: ctx.semestre1Id,
        typeId: ctx.devoirTypeId,
        title: 'Evaluation hors cadre',
      });

    expect(res.status).toBe(404);
  });
});

describe('Phase 4 — workflow brouillon -> valide -> publie', () => {
  let ctx: Contexte;
  let admin: Agent;

  async function creerEvaluation(agent: Agent, title = 'Devoir 1 Maths') {
    const res = await agent
      .post('/api/assessments')
      .set('x-csrf-token', await csrf(agent))
      .send({
        classroomSubjectId: ctx.mathsCsf,
        semesterId: ctx.semestre1Id,
        typeId: ctx.devoirTypeId,
        title,
      });
    expect(res.status).toBe(201);
    return res.body.assessment.id as string;
  }

  beforeEach(async () => {
    await cleanTestDb();
    const school = await createSchool('Lycée Alpha');
    await createUser({ email: 'admin@alpha.sn', role: 'SCHOOL_ADMIN', schoolId: school.id });
    ctx = await creerContexte(school.id);
    admin = await loginAs('admin@alpha.sn');
  });

  it('interdit de valider directement depuis le brouillon', async () => {
    const id = await creerEvaluation(admin);
    const res = await admin
      .post(`/api/assessments/${id}/statut`)
      .set('x-csrf-token', await csrf(admin))
      .send({ status: 'VALIDEE' });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Transition interdite');
  });

  it('bloque la validation tant que la saisie est incomplète', async () => {
    const id = await creerEvaluation(admin);
    await admin
      .post(`/api/assessments/${id}/statut`)
      .set('x-csrf-token', await csrf(admin))
      .send({ status: 'A_VERIFIER' });

    const res = await admin
      .post(`/api/assessments/${id}/statut`)
      .set('x-csrf-token', await csrf(admin))
      .send({ status: 'VALIDEE' });

    expect(res.status).toBe(422);
    expect(res.body.error).toContain('Saisie incomplète');
    expect(res.body.error).toContain('4 élève(s) sans note');
  });

  it('parcourt le workflow complet puis fige l\'evaluation publiee', async () => {
    const id = await creerEvaluation(admin);
    for (const status of ['SAISIE_EN_COURS', 'A_VERIFIER']) {
      const res = await admin
        .post(`/api/assessments/${id}/statut`)
        .set('x-csrf-token', await csrf(admin))
        .send({ status });
      expect(res.status).toBe(200);
      expect(res.body.assessment.status).toBe(status);
    }

    const saisie = await admin
      .put('/api/grades')
      .set('x-csrf-token', await csrf(admin))
      .send({
        assessmentId: id,
        notes: ctx.eleves.map((e) => ({ enrollmentId: e.enrollmentId, score: 12, status: 'SAISIE' })),
      });
    expect(saisie.status).toBe(200);
    expect(saisie.body.enregistrees).toBe(4);

    const validee = await admin
      .post(`/api/assessments/${id}/statut`)
      .set('x-csrf-token', await csrf(admin))
      .send({ status: 'VALIDEE' });
    expect(validee.status).toBe(200);
    expect(validee.body.assessment.validatedAt).not.toBeNull();

    const modifApresValidation = await admin
      .patch(`/api/assessments/${id}`)
      .set('x-csrf-token', await csrf(admin))
      .send({ title: ' Titre change ' });
    expect(modifApresValidation.status).toBe(409);

    const saisieApresValidation = await admin
      .put('/api/grades')
      .set('x-csrf-token', await csrf(admin))
      .send({
        assessmentId: id,
        notes: [{ enrollmentId: ctx.eleves[0].enrollmentId, score: 19, status: 'SAISIE' }],
      });
    expect(saisieApresValidation.status).toBe(409);

    const publiee = await admin
      .post(`/api/assessments/${id}/statut`)
      .set('x-csrf-token', await csrf(admin))
      .send({ status: 'PUBLIEE' });
    expect(publiee.status).toBe(200);
    expect(publiee.body.assessment.publishedAt).not.toBeNull();

    const suppression = await admin
      .delete(`/api/assessments/${id}`)
      .set('x-csrf-token', await csrf(admin));
    expect(suppression.status).toBe(409);

    const retour = await admin
      .post(`/api/assessments/${id}/statut`)
      .set('x-csrf-token', await csrf(admin))
      .send({ status: 'A_VERIFIER' });
    expect(retour.status).toBe(409);
  });

  it('trace les transitions et les saisies dans les journaux d\'audit', async () => {
    const id = await creerEvaluation(admin);
    await admin
      .put('/api/grades')
      .set('x-csrf-token', await csrf(admin))
      .send({
        assessmentId: id,
        notes: [{ enrollmentId: ctx.eleves[0].enrollmentId, score: 12, status: 'SAISIE' }],
      });

    const actions = await prisma.auditLog.findMany({
      where: { schoolId: ctx.schoolId },
      select: { action: true },
    });
    const noms = actions.map((a) => a.action);
    expect(noms).toContain('ASSESSMENT_CREATED');
    expect(noms).toContain('GRADES_SAVED');
  });
});

describe('Phase 4 — permissions de saisie et de validation', () => {
  let ctx: Contexte;

  beforeEach(async () => {
    await cleanTestDb();
    const school = await createSchool('Lycée Alpha');
    await createUser({ email: 'admin@alpha.sn', role: 'SCHOOL_ADMIN', schoolId: school.id });
    await createUser({ email: 'surveillant@alpha.sn', role: 'SURVEILLANT_GENERAL', schoolId: school.id });
    await createUser({ email: 'assistante@alpha.sn', role: 'ASSISTANT', schoolId: school.id });
    ctx = await creerContexte(school.id);
  });

  it('allow the assistant to enter grades but not to validate', async () => {
    const admin = await loginAs('admin@alpha.sn');
    const created = await admin
      .post('/api/assessments')
      .set('x-csrf-token', await csrf(admin))
      .send({
        classroomSubjectId: ctx.mathsCsf,
        semesterId: ctx.semestre1Id,
        typeId: ctx.devoirTypeId,
        title: 'Devoir 1 Maths',
      });
    expect(created.status).toBe(201);
    const id = created.body.assessment.id as string;

    const assistante = await loginAs('assistante@alpha.sn');
    const grille = await assistante.get(`/api/grade-grid?assessmentId=${id}`);
    expect(grille.status).toBe(200);
    expect(grille.body.lignes).toHaveLength(4);
    expect(grille.body.assessment.saisieAutorisee).toBe(true);

    const saisie = await assistante
      .put('/api/grades')
      .set('x-csrf-token', await csrf(assistante))
      .send({
        assessmentId: id,
        notes: ctx.eleves.map((e) => ({ enrollmentId: e.enrollmentId, score: 11, status: 'SAISIE' })),
      });
    expect(saisie.status).toBe(200);
    expect(saisie.body.indicateur).toContain('4 note(s) enregistrée(s)');

    const retourSaisie = await assistante
      .post(`/api/assessments/${id}/statut`)
      .set('x-csrf-token', await csrf(assistante))
      .send({ status: 'A_VERIFIER' });
    expect(retourSaisie.status).toBe(200);

    const validation = await assistante
      .post(`/api/assessments/${id}/statut`)
      .set('x-csrf-token', await csrf(assistante))
      .send({ status: 'VALIDEE' });
    expect(validation.status).toBe(403);

    const publication = await assistante
      .post(`/api/assessments/${id}/statut`)
      .set('x-csrf-token', await csrf(assistante))
      .send({ status: 'PUBLIEE' });
    expect(publication.status).toBe(403);
  });

  it('allows the surveillance teacher to validate', async () => {
    const admin = await loginAs('admin@alpha.sn');
    const created = await admin
      .post('/api/assessments')
      .set('x-csrf-token', await csrf(admin))
      .send({
        classroomSubjectId: ctx.mathsCsf,
        semesterId: ctx.semestre1Id,
        typeId: ctx.devoirTypeId,
        title: 'Devoir 1 Maths',
      });
    const id = created.body.assessment.id as string;

    await admin
      .put('/api/grades')
      .set('x-csrf-token', await csrf(admin))
      .send({
        assessmentId: id,
        notes: ctx.eleves.map((e) => ({ enrollmentId: e.enrollmentId, score: 10, status: 'SAISIE' })),
      });

    const surveillant = await loginAs('surveillant@alpha.sn');
    await surveillant
      .post(`/api/assessments/${id}/statut`)
      .set('x-csrf-token', await csrf(surveillant))
      .send({ status: 'A_VERIFIER' });

    const validee = await surveillant
      .post(`/api/assessments/${id}/statut`)
      .set('x-csrf-token', await csrf(surveillant))
      .send({ status: 'VALIDEE' });
    expect(validee.status).toBe(200);
    expect(validee.body.assessment.status).toBe('VALIDEE');
  });

  it('refuse l\'accès aux notes sans authentification', async () => {
    const res = await (await sansSession()).get('/api/assessments');
    expect(res.status).toBe(401);
  });
});

describe('Phase 4 — règles de saisie des notes', () => {
  let ctx: Contexte;
  let admin: Agent;
  let assessmentId: string;

  beforeEach(async () => {
    await cleanTestDb();
    const school = await createSchool('Lycée Alpha');
    await createUser({ email: 'admin@alpha.sn', role: 'SCHOOL_ADMIN', schoolId: school.id });
    ctx = await creerContexte(school.id);
    admin = await loginAs('admin@alpha.sn');
    const created = await admin
      .post('/api/assessments')
      .set('x-csrf-token', await csrf(admin))
      .send({
        classroomSubjectId: ctx.mathsCsf,
        semesterId: ctx.semestre1Id,
        typeId: ctx.devoirTypeId,
        title: 'Devoir 1 Maths',
      });
    assessmentId = created.body.assessment.id as string;
  });

  it('enregistre une note, la met à jour sans doublon et signale l\'indicateur', async () => {
    const premiere = await admin
      .put('/api/grades')
      .set('x-csrf-token', await csrf(admin))
      .send({
        assessmentId,
        notes: [{ enrollmentId: ctx.eleves[0].enrollmentId, score: '12,5', status: 'SAISIE' }],
      });
    expect(premiere.status).toBe(200);
    expect(premiere.body.enregistrees).toBe(1);

    const seconde = await admin
      .put('/api/grades')
      .set('x-csrf-token', await csrf(admin))
      .send({
        assessmentId,
        notes: [{ enrollmentId: ctx.eleves[0].enrollmentId, score: 13.5, status: 'SAISIE' }],
      });
    expect(seconde.status).toBe(200);

    const grille = await admin.get(`/api/grade-grid?assessmentId=${assessmentId}`);
    expect(grille.body.lignes[0].score).toBe('13.5');
    expect(await prisma.grade.count({ where: { assessmentId } })).toBe(1);
  });

  it('refuse une note hors barème sans rien enregistrer', async () => {
    const res = await admin
      .put('/api/grades')
      .set('x-csrf-token', await csrf(admin))
      .send({
        assessmentId,
        notes: [
          { enrollmentId: ctx.eleves[0].enrollmentId, score: 12, status: 'SAISIE' },
          { enrollmentId: ctx.eleves[1].enrollmentId, score: 25, status: 'SAISIE' },
        ],
      });

    expect(res.status).toBe(422);
    expect(res.body.details.erreurs).toHaveLength(1);
    expect(res.body.details.erreurs[0].message).toContain('barème');
    expect(await prisma.grade.count({ where: { assessmentId } })).toBe(0);
  });

  it('refuse un score avec un statut absence, annulation ou non saisi', async () => {
    const absent = await admin
      .put('/api/grades')
      .set('x-csrf-token', await csrf(admin))
      .send({
        assessmentId,
        notes: [{ enrollmentId: ctx.eleves[0].enrollmentId, score: 0, status: 'ABSENT' }],
      });
    expect(absent.status).toBe(422);
    expect(absent.body.details.erreurs[0].message).toContain('ABSENT');

    const sansScore = await admin
      .put('/api/grades')
      .set('x-csrf-token', await csrf(admin))
      .send({
        assessmentId,
        notes: [{ enrollmentId: ctx.eleves[0].enrollmentId, status: 'SAISIE' }],
      });
    expect(sansScore.status).toBe(422);

    const ok = await admin
      .put('/api/grades')
      .set('x-csrf-token', await csrf(admin))
      .send({
        assessmentId,
        notes: [
          { enrollmentId: ctx.eleves[0].enrollmentId, status: 'ABSENT', observation: 'Absence justifiée' },
          { enrollmentId: ctx.eleves[1].enrollmentId, status: 'ANNULEE' },
          { enrollmentId: ctx.eleves[2].enrollmentId, status: 'NON_SAISIE' },
        ],
      });
    expect(ok.status).toBe(200);

    const grille = await admin.get(`/api/grade-grid?assessmentId=${assessmentId}`);
    const lignes = new Map(grille.body.lignes.map((l: { enrollmentId: string; status: string }) => [l.enrollmentId, l.status]));
    expect(lignes.get(ctx.eleves[0].enrollmentId)).toBe('ABSENT');
    expect(lignes.get(ctx.eleves[1].enrollmentId)).toBe('ANNULEE');
    expect(lignes.get(ctx.eleves[3].enrollmentId)).toBe('NON_SAISIE');
  });

  it('refuse un élève qui n\'appartient pas à la classe de l\'évaluation', async () => {
    const autreEcole = await createSchool('Lycée Beta');
    const autreCtx = await creerContexte(autreEcole.id, 1);

    const res = await admin
      .put('/api/grades')
      .set('x-csrf-token', await csrf(admin))
      .send({
        assessmentId,
        notes: [{ enrollmentId: autreCtx.eleves[0].enrollmentId, score: 15, status: 'SAISIE' }],
      });

    expect(res.status).toBe(400);
    expect(await prisma.grade.count({ where: { assessmentId } })).toBe(0);
  });

  it('refuse la saisie sur une évaluation validée', async () => {
    await admin
      .put('/api/grades')
      .set('x-csrf-token', await csrf(admin))
      .send({
        assessmentId,
        notes: ctx.eleves.map((e) => ({ enrollmentId: e.enrollmentId, score: 10, status: 'SAISIE' })),
      });
    await admin
      .post(`/api/assessments/${assessmentId}/statut`)
      .set('x-csrf-token', await csrf(admin))
      .send({ status: 'A_VERIFIER' });
    await admin
      .post(`/api/assessments/${assessmentId}/statut`)
      .set('x-csrf-token', await csrf(admin))
      .send({ status: 'VALIDEE' });

    const res = await admin
      .put('/api/grades')
      .set('x-csrf-token', await csrf(admin))
      .send({
        assessmentId,
        notes: [{ enrollmentId: ctx.eleves[0].enrollmentId, score: 18, status: 'SAISIE' }],
      });
    expect(res.status).toBe(409);
  });
});

describe('Phase 4 — isolation entre établissements', () => {
  let alpha: Contexte;
  let beta: Contexte;

  beforeEach(async () => {
    await cleanTestDb();
    const ecoleAlpha = await createSchool('Lycée Alpha');
    await createUser({ email: 'admin@alpha.sn', role: 'SCHOOL_ADMIN', schoolId: ecoleAlpha.id });
    const ecoleBeta = await createSchool('Lycée Beta');
    await createUser({ email: 'admin@beta.sn', role: 'SCHOOL_ADMIN', schoolId: ecoleBeta.id });
    alpha = await creerContexte(ecoleAlpha.id);
    beta = await creerContexte(ecoleBeta.id);
  });

  it('ne expose ni grille, ni évaluation, ni calcul de l\'autre établissement', async () => {
    const adminAlpha = await loginAs('admin@alpha.sn');
    const created = await adminAlpha
      .post('/api/assessments')
      .set('x-csrf-token', await csrf(adminAlpha))
      .send({
        classroomSubjectId: alpha.mathsCsf,
        semesterId: alpha.semestre1Id,
        typeId: alpha.devoirTypeId,
        title: 'Devoir 1 Maths',
      });
    const assessmentId = created.body.assessment.id as string;

    const adminBeta = await loginAs('admin@beta.sn');

    const grille = await adminBeta.get(`/api/grade-grid?assessmentId=${assessmentId}`);
    expect(grille.status).toBe(404);

    const modification = await adminBeta
      .patch(`/api/assessments/${assessmentId}`)
      .set('x-csrf-token', await csrf(adminBeta))
      .send({ title: 'Detournee' });
    expect(modification.status).toBe(404);

    const saisie = await adminBeta
      .put('/api/grades')
      .set('x-csrf-token', await csrf(adminBeta))
      .send({
        assessmentId,
        notes: [{ enrollmentId: alpha.eleves[0].enrollmentId, score: 20, status: 'SAISIE' }],
      });
    expect(saisie.status).toBe(404);

    const calcul = await adminBeta.get(`/api/calculations?classroomId=${alpha.classroomId}`);
    expect(calcul.status).toBe(404);

    const liste = await adminBeta.get('/api/assessments');
    expect(liste.status).toBe(200);
    expect(liste.body.assessments).toHaveLength(0);

    expect(await prisma.grade.count({ where: { schoolId: beta.schoolId } })).toBe(0);
  });

  it('accepte le même code de type dans deux établissements différents', async () => {
    const adminAlpha = await loginAs('admin@alpha.sn');
    const adminBeta = await loginAs('admin@beta.sn');

    const conflitDansBeta = await adminBeta
      .post('/api/assessment-types')
      .set('x-csrf-token', await csrf(adminBeta))
      .send({ code: 'DEV', name: 'Devoir surveillé', category: 'DEVOIR' });
    expect(conflitDansBeta.status).toBe(409);

    const typesAlpha = await adminAlpha.get('/api/assessment-types');
    const typesBeta = await adminBeta.get('/api/assessment-types');
    expect(typesAlpha.body.types).toHaveLength(2);
    expect(typesBeta.body.types).toHaveLength(2);

    const idsAlpha = new Set(typesAlpha.body.types.map((t: { id: string }) => t.id));
    for (const typeBeta of typesBeta.body.types) {
      expect(idsAlpha.has(typeBeta.id)).toBe(false);
      expect(typeBeta.schoolId).toBe(beta.schoolId);
    }
  });
});

describe('Phase 4 — affectations discipline / classe', () => {
  let ctx: Contexte;
  let admin: Agent;
  let philoId: string;

  beforeEach(async () => {
    await cleanTestDb();
    const school = await createSchool('Lycée Alpha');
    await createUser({ email: 'admin@alpha.sn', role: 'SCHOOL_ADMIN', schoolId: school.id });
    ctx = await creerContexte(school.id);
    const philo = await prisma.subject.create({
      data: { schoolId: school.id, name: 'Philosophie', code: 'PHILO' },
    });
    philoId = philo.id;
    admin = await loginAs('admin@alpha.sn');
  });

  it('affecte une discipline à une classe avec son coefficient', async () => {
    const res = await admin
      .post('/api/schooling/classroom-subjects')
      .set('x-csrf-token', await csrf(admin))
      .send({ classroomId: ctx.classroomId, subjectId: philoId, coefficient: '2,5' });

    expect(res.status).toBe(201);
    expect(res.body.classroomSubject.coefficient).toBe('2.5');
    expect(res.body.classroomSubject.subjectId).toBe(philoId);

    const liste = await admin.get(`/api/schooling/classroom-subjects?classroomId=${ctx.classroomId}`);
    expect(liste.status).toBe(200);
    expect(liste.body.classroomSubjects).toHaveLength(3);
    expect(liste.body.classroomSubjects.map((c: { coefficient: string }) => c.coefficient)).toContain('2.5');
  });

  it('refuse le doublon discipline / classe', async () => {
    const res = await admin
      .post('/api/schooling/classroom-subjects')
      .set('x-csrf-token', await csrf(admin))
      .send({ classroomId: ctx.classroomId, subjectId: philoId, coefficient: 3 });
    expect(res.status).toBe(201);

    const doublon = await admin
      .post('/api/schooling/classroom-subjects')
      .set('x-csrf-token', await csrf(admin))
      .send({ classroomId: ctx.classroomId, subjectId: philoId, coefficient: 4 });
    expect(doublon.status).toBe(409);
  });

  it('modifie un coefficient en conservant la version précédente et son historique', async () => {
    const affectation = await admin
      .post('/api/schooling/classroom-subjects')
      .set('x-csrf-token', await csrf(admin))
      .send({ classroomId: ctx.classroomId, subjectId: philoId, coefficient: '2' });
    expect(affectation.status).toBe(201);

    const updated = await admin
      .patch(`/api/schooling/classroom-subjects/${affectation.body.classroomSubject.id}/coefficient`)
      .set('x-csrf-token', await csrf(admin))
      .send({ coefficient: '3,5' });

    expect(updated.status, JSON.stringify(updated.body)).toBe(201);
    expect(updated.body.classroomSubject.coefficient).toBe('3.5');
    expect(updated.body.classroomSubject.effectiveFrom).toEqual(expect.any(String));

    const history = await admin.get(`/api/schooling/classroom-subjects?classroomId=${ctx.classroomId}`);
    const versions = history.body.classroomSubjects.filter(
      (row: { subjectId: string }) => row.subjectId === philoId,
    );
    expect(versions).toHaveLength(2);
    const previous = versions.find(
      (row: { id: string }) => row.id === affectation.body.classroomSubject.id,
    );
    const current = versions.find(
      (row: { id: string }) => row.id === updated.body.classroomSubject.id,
    );
    expect(previous.coefficient).toBe('2');
    expect(previous.effectiveTo).toBe(current.effectiveFrom);
    expect(current.effectiveTo).toBeNull();
  });

  it('refuse un coefficient non numérique', async () => {
    const res = await admin
      .post('/api/schooling/classroom-subjects')
      .set('x-csrf-token', await csrf(admin))
      .send({ classroomId: ctx.classroomId, subjectId: philoId, coefficient: 'beaucoup' });
    expect(res.status).toBe(400);
  });

  it('refuse un coefficient de remplacement avec plus de deux décimales', async () => {
    const affectation = await admin
      .post('/api/schooling/classroom-subjects')
      .set('x-csrf-token', await csrf(admin))
      .send({ classroomId: ctx.classroomId, subjectId: philoId, coefficient: 2 });
    expect(affectation.status).toBe(201);

    const response = await admin
      .patch(`/api/schooling/classroom-subjects/${affectation.body.classroomSubject.id}/coefficient`)
      .set('x-csrf-token', await csrf(admin))
      .send({ coefficient: '2.345' });
    expect(response.status).toBe(400);
  });

  it('refuse une classe ou une discipline d\'un autre établissement', async () => {
    const autreEcole = await createSchool('Lycée Omega');
    await createUser({ email: 'admin@omega.sn', role: 'SCHOOL_ADMIN', schoolId: autreEcole.id });
    const omega = await creerContexte(autreEcole.id, 1);
    const sujetOmega = await prisma.subject.create({
      data: { schoolId: autreEcole.id, name: 'SVT', code: 'SVT' },
    });

    const adminOmega = await loginAs('admin@omega.sn');
    const classeHorsEcole = await adminOmega
      .post('/api/schooling/classroom-subjects')
      .set('x-csrf-token', await csrf(adminOmega))
      .send({ classroomId: ctx.classroomId, subjectId: sujetOmega.id, coefficient: 1 });
    expect(classeHorsEcole.status).toBe(404);

    const disciplineHorsEcole = await adminOmega
      .post('/api/schooling/classroom-subjects')
      .set('x-csrf-token', await csrf(adminOmega))
      .send({ classroomId: omega.classroomId, subjectId: philoId, coefficient: 1 });
    expect(disciplineHorsEcole.status).toBe(404);
  });

  it('permet de créer une évaluation sur une affectation récente', async () => {
    const affectation = await admin
      .post('/api/schooling/classroom-subjects')
      .set('x-csrf-token', await csrf(admin))
      .send({ classroomId: ctx.classroomId, subjectId: philoId, coefficient: 2 });
    expect(affectation.status).toBe(201);

    const evaluation = await admin
      .post('/api/assessments')
      .set('x-csrf-token', await csrf(admin))
      .send({
        classroomSubjectId: affectation.body.classroomSubject.id,
        semesterId: ctx.semestre1Id,
        typeId: ctx.devoirTypeId,
        title: 'Devoir 1 Philosophie',
      });
    expect(evaluation.status).toBe(201);

    const grille = await admin.get(`/api/grade-grid?assessmentId=${evaluation.body.assessment.id}`);
    expect(grille.body.lignes).toHaveLength(4);
  });

  it('refuse une affectation sur une année scolaire clôturée', async () => {
    await prisma.academicYear.update({
      where: { id: ctx.academicYearId },
      data: { status: 'CLOSED' },
    });

    const res = await admin
      .post('/api/schooling/classroom-subjects')
      .set('x-csrf-token', await csrf(admin))
      .send({ classroomId: ctx.classroomId, subjectId: philoId, coefficient: 1 });
    expect(res.status).toBe(409);
  });
});

describe('Phase 4 — calcul des moyennes et classement', () => {
  let ctx: Contexte;
  let admin: Agent;

  beforeEach(async () => {
    await cleanTestDb();
    const school = await createSchool('Lycée Alpha');
    await createUser({ email: 'admin@alpha.sn', role: 'SCHOOL_ADMIN', schoolId: school.id });
    ctx = await creerContexte(school.id);
    await creerScenarioCalcul(ctx);
    admin = await loginAs('admin@alpha.sn');
  });

  it('retourne moyennes par matière, moyenne générale, points pondérés et rangs avec ex aequo', async () => {
    const res = await admin.get(
      `/api/calculations?classroomId=${ctx.classroomId}&semesterId=${ctx.semestre1Id}`
    );

    expect(res.status).toBe(200);
    expect(res.body.effectif).toBe(4);
    expect(res.body.moyenneClasse).toBe('13.85');

    const parMatricule = new Map(res.body.eleves.map((e: { matricule: string }) => [e.matricule, e]));
    const alpha = parMatricule.get('ELV-1');
    const beta = parMatricule.get('ELV-2');
    const gamma = parMatricule.get('ELV-3');
    const delta = parMatricule.get('ELV-4');

    expect(alpha.moyenneGenerale).toBe('15.20');
    expect(alpha.moyenneGeneraleExacte).toBe('15.2');
    expect(alpha.totalPoints).toBe('76');
    expect(alpha.totalCoeficients).toBe('5');
    expect(alpha.rang).toBe(1);

    expect(beta.moyenneGeneraleExacte).toBe('14.8');
    expect(beta.rang).toBe(2);
    expect(gamma.moyenneGeneraleExacte).toBe('14.8');
    expect(gamma.rang).toBe(2);
    expect(delta.rang).toBe(4);

    const mathsDelta = delta.matieres.find((m: { subjectName: string }) => m.subjectName === 'Mathématiques');
    expect(mathsDelta.moyenne).toBe('11.00');
    expect(mathsDelta.coefficient).toBe('3');
    expect(mathsDelta.pointsPonderes).toBe('33');
  });

  it('utilise le nouveau coefficient pour les calculs sans dupliquer la matière historique', async () => {
    const updated = await admin
      .patch(`/api/schooling/classroom-subjects/${ctx.mathsCsf}/coefficient`)
      .set('x-csrf-token', await csrf(admin))
      .send({ coefficient: '5' });
    expect(updated.status, JSON.stringify(updated.body)).toBe(201);

    const result = await admin.get(
      `/api/calculations?classroomId=${ctx.classroomId}&semesterId=${ctx.semestre1Id}`,
    );
    expect(result.status).toBe(200);
    const alpha = result.body.eleves.find((e: { matricule: string }) => e.matricule === 'ELV-1');
    const maths = alpha.matieres.filter(
      (subject: { subjectName: string }) => subject.subjectName === 'Mathématiques',
    );
    expect(maths).toHaveLength(1);
    expect(maths[0].coefficient).toBe('5');
    expect(maths[0].pointsPonderes).toBe('80');
  });

  it('exclut les évaluations non validées du calcul, et les inclut en prévisualisation', async () => {
    await evalValidee(ctx, {
      classroomSubjectId: ctx.mathsCsf,
      semesterId: ctx.semestre1Id,
      typeId: ctx.devoirTypeId,
      title: 'Devoir 2 Maths (brouillon)',
      position: 2,
      status: 'A_VERIFIER',
      notes: ctx.eleves.map((e) => ({ enrollmentId: e.enrollmentId, score: 20 })),
    });

    const sansBrouillon = await admin.get(
      `/api/calculations?classroomId=${ctx.classroomId}&semesterId=${ctx.semestre1Id}`
    );
    expect(sansBrouillon.body.motifs.join(' ')).toContain('non validée');
    const alphaOfficiel = sansBrouillon.body.eleves.find((e: { matricule: string }) => e.matricule === 'ELV-1');
    expect(alphaOfficiel.moyenneGeneraleExacte).toBe('15.2');

    const avecBrouillon = await admin.get(
      `/api/calculations?classroomId=${ctx.classroomId}&semesterId=${ctx.semestre1Id}&inclureBrouillons=true`
    );
    const alphaTest = avecBrouillon.body.eleves.find((e: { matricule: string }) => e.matricule === 'ELV-1');
    expect(alphaTest.moyenneGeneraleExacte).toBe('15.8');
    expect(alphaTest.incomplet).toBe(false);
  });

  it('signale une matière incomplète sans inventer de moyenne', async () => {
    await evalValidee(ctx, {
      classroomSubjectId: ctx.histoireCsf,
      semesterId: ctx.semestre1Id,
      typeId: ctx.devoirTypeId,
      title: 'Devoir 2 Histoire (incomplet)',
      position: 2,
      notes: [{ enrollmentId: ctx.eleves[0].enrollmentId, status: 'NON_SAISIE', score: null }],
    });

    const res = await admin.get(
      `/api/calculations?classroomId=${ctx.classroomId}&semesterId=${ctx.semestre1Id}`
    );
    const alpha = res.body.eleves.find((e: { matricule: string }) => e.matricule === 'ELV-1');
    expect(alpha.incomplet).toBe(true);
    const histoire = alpha.matieres.find((m: { subjectName: string }) => m.subjectName === 'Histoire-Géographie');
    expect(histoire.moyenne).toBe('14.00');
    expect(histoire.moyenneExacte).toBe('14');
    expect(histoire.motifs.join(' ')).toContain('note manquante');
  });

  it('refuse de calculer une classe vide de disciplines', async () => {
    const autreEcole = await createSchool('Lycée Zeta');
    await createUser({ email: 'admin@zeta.sn', role: 'SCHOOL_ADMIN', schoolId: autreEcole.id });
    const ctxVide = await creerContexte(autreEcole.id);
    await prisma.classroomSubject.deleteMany({ where: { schoolId: autreEcole.id } });

    const adminZeta = await loginAs('admin@zeta.sn');
    const res = await adminZeta.get(`/api/calculations?classroomId=${ctxVide.classroomId}`);
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('discipline');
  });

  it('calcule la moyenne annuelle à partir des deux semestres', async () => {
    const n = (idx: number) => ctx.eleves[idx].enrollmentId;
    await evalValidee(ctx, {
      classroomSubjectId: ctx.mathsCsf,
      semesterId: ctx.semestre2Id,
      typeId: ctx.devoirTypeId,
      title: 'Devoir 1 Maths S2',
      notes: [
        { enrollmentId: n(0), score: 18 },
        { enrollmentId: n(1), score: 15 },
        { enrollmentId: n(2), score: 15 },
        { enrollmentId: n(3), score: 12 },
      ],
    });
    await evalValidee(ctx, {
      classroomSubjectId: ctx.mathsCsf,
      semesterId: ctx.semestre2Id,
      typeId: ctx.compositionTypeId,
      title: 'Composition Maths S2',
      notes: [
        { enrollmentId: n(0), score: 18 },
        { enrollmentId: n(1), score: 15 },
        { enrollmentId: n(2), score: 15 },
        { enrollmentId: n(3), score: 12 },
      ],
    });
    await evalValidee(ctx, {
      classroomSubjectId: ctx.histoireCsf,
      semesterId: ctx.semestre2Id,
      typeId: ctx.devoirTypeId,
      title: 'Devoir 1 Histoire S2',
      notes: [
        { enrollmentId: n(0), score: 16 },
        { enrollmentId: n(1), score: 16 },
        { enrollmentId: n(2), score: 16 },
        { enrollmentId: n(3), score: 10 },
      ],
    });
    await evalValidee(ctx, {
      classroomSubjectId: ctx.histoireCsf,
      semesterId: ctx.semestre2Id,
      typeId: ctx.compositionTypeId,
      title: 'Composition Histoire S2',
      notes: [
        { enrollmentId: n(0), score: 16 },
        { enrollmentId: n(1), score: 16 },
        { enrollmentId: n(2), score: 16 },
        { enrollmentId: n(3), score: 10 },
      ],
    });

    const res = await admin.get(
      `/api/calculations/annual?classroomId=${ctx.classroomId}&academicYearId=${ctx.academicYearId}`
    );
    expect(res.status).toBe(200);
    expect(res.body.effectif).toBe(4);

    const alpha = res.body.eleves.find((e: { matricule: string }) => e.matricule === 'ELV-1');
    expect(alpha.s1).toBe('15.2');
    expect(alpha.s2).toBe('17.2');
    expect(alpha.annuelleExacte).toBe('16.2');
    expect(alpha.annuelle).toBe('16.20');
    expect(alpha.calculable).toBe(true);

    const delta = res.body.eleves.find((e: { matricule: string }) => e.matricule === 'ELV-4');
    expect(delta.s1).toBe('10.6');
    expect(delta.s2).toBe('11.2');
    expect(delta.annuelleExacte).toBe('10.9');
  });

  it('ne produit pas d\'annuelle quand un seul semestre est saisi', async () => {
    const res = await admin.get(
      `/api/calculations/annual?classroomId=${ctx.classroomId}&academicYearId=${ctx.academicYearId}`
    );
    expect(res.status).toBe(200);

    const alpha = res.body.eleves.find((e: { matricule: string }) => e.matricule === 'ELV-1');
    expect(alpha.s2).toBeNull();
    expect(alpha.annuelleExacte).toBeNull();
    expect(alpha.annuelle).toBeNull();
    expect(alpha.calculable).toBe(false);
    expect(alpha.motifs.join(' ')).toContain('semestre');
  });
});

describe('Phase 4 — suppression d\'une évaluation', () => {
  let ctx: Contexte;
  let admin: Agent;

  beforeEach(async () => {
    await cleanTestDb();
    const school = await createSchool('Lycée Alpha');
    await createUser({ email: 'admin@alpha.sn', role: 'SCHOOL_ADMIN', schoolId: school.id });
    ctx = await creerContexte(school.id);
    await creerScenarioCalcul(ctx);
    admin = await loginAs('admin@alpha.sn');
  });

  /** Soft delete : la ligne reste en base, elle disparaît des listes et des calculs. */
  it('supprime une évaluation non publiée et la retire du classement', async () => {
    const devoir = await prisma.assessment.findFirstOrThrow({
      where: { schoolId: ctx.schoolId, title: 'Devoir 1 Maths' },
    });

    const suppr = await admin
      .delete(`/api/assessments/${devoir.id}`)
      .set('x-csrf-token', await csrf(admin));
    expect(suppr.status).toBe(204);

    const liste = await admin.get(
      `/api/assessments?classroomSubjectId=${ctx.mathsCsf}&semesterId=${ctx.semestre1Id}`
    );
    expect(liste.status).toBe(200);
    expect(
      liste.body.assessments.some((a: { id: string }) => a.id === devoir.id)
    ).toBe(false);

    const enBase = await prisma.assessment.findUnique({ where: { id: devoir.id } });
    expect(enBase?.deletedAt).not.toBeNull();
    expect(await prisma.grade.count({ where: { assessmentId: devoir.id } })).toBe(4);

    // Maths ne garde que la composition : Gamma passe de 14 à 15, donc rang 1.
    const calcul = await admin.get(
      `/api/calculations?classroomId=${ctx.classroomId}&semesterId=${ctx.semestre1Id}`
    );
    expect(calcul.status).toBe(200);
    const gamma = calcul.body.eleves.find((e: { matricule: string }) => e.matricule === 'ELV-3');
    expect(gamma.moyenneGeneraleExacte).toBe('15.4');
    expect(gamma.rang).toBe(1);
    expect(calcul.body.moyenneClasse).toBe('14.15');
  });

  it('refuse de supprimer une évaluation publiée', async () => {
    const publiee = await evalValidee(ctx, {
      classroomSubjectId: ctx.mathsCsf,
      semesterId: ctx.semestre1Id,
      typeId: ctx.devoirTypeId,
      title: 'Devoir publié',
      position: 9,
      status: 'PUBLIEE',
      notes: [{ enrollmentId: ctx.eleves[0].enrollmentId, score: 12 }],
    });

    const res = await admin
      .delete(`/api/assessments/${publiee.id}`)
      .set('x-csrf-token', await csrf(admin));

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('bulletins');
    const enBase = await prisma.assessment.findUnique({ where: { id: publiee.id } });
    expect(enBase?.deletedAt).toBeNull();
  });

  it('refuse une seconde suppression et une suppression sans jeton CSRF', async () => {
    const cible = await prisma.assessment.findFirstOrThrow({
      where: { schoolId: ctx.schoolId, title: 'Composition Maths' },
    });

    const sansJeton = await admin.delete(`/api/assessments/${cible.id}`);
    expect(sansJeton.status).toBe(403);

    const premier = await admin
      .delete(`/api/assessments/${cible.id}`)
      .set('x-csrf-token', await csrf(admin));
    expect(premier.status).toBe(204);

    const second = await admin
      .delete(`/api/assessments/${cible.id}`)
      .set('x-csrf-token', await csrf(admin));
    expect(second.status).toBe(404);
  });

  it('laisse un autre établissement étranger à l\'évaluation', async () => {
    const ecoleBeta = await createSchool('Lycée Beta');
    await createUser({ email: 'admin@beta.sn', role: 'SCHOOL_ADMIN', schoolId: ecoleBeta.id });
    const adminBeta = await loginAs('admin@beta.sn');

    const cible = await prisma.assessment.findFirstOrThrow({
      where: { schoolId: ctx.schoolId, title: 'Devoir 1 Histoire' },
    });

    const res = await adminBeta
      .delete(`/api/assessments/${cible.id}`)
      .set('x-csrf-token', await csrf(adminBeta));

    expect(res.status).toBe(404);
    const enBase = await prisma.assessment.findUnique({ where: { id: cible.id } });
    expect(enBase?.deletedAt).toBeNull();
  });

  it('trace la suppression dans le journal d\'audit', async () => {
    const cible = await prisma.assessment.findFirstOrThrow({
      where: { schoolId: ctx.schoolId, title: 'Composition Histoire' },
    });

    await admin
      .delete(`/api/assessments/${cible.id}`)
      .set('x-csrf-token', await csrf(admin));

    const journaux = await prisma.auditLog.findMany({
      where: { schoolId: ctx.schoolId, entityId: cible.id },
      select: { action: true },
    });
    expect(journaux.map((j) => j.action)).toContain('ASSESSMENT_DELETED');
  });
});
