import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import app from '../src/app';
import { cleanTestDb, createSchool, createUser } from './helpers';
import { prisma } from '../src/db/prisma';
import { hashPassword } from '../src/lib/password';

async function loginAs(email: string, password: string) {
  const agent = request.agent(app);
  const session = await agent.get('/api/auth/session');
  const csrf = session.body.csrfToken as string;
  const login = await agent
    .post('/api/auth/login')
    .set('x-csrf-token', csrf)
    .send({ email, password });
  return { agent, csrf: (login.body.csrfToken as string | undefined) ?? csrf };
}

describe('Organisation scolaire', () => {
  beforeEach(async () => {
    await cleanTestDb();
  });

  it('crée une année scolaire avec deux semestres distincts et auditables', async () => {
    const school = await createSchool();
    await createUser({
      email: 'organisation@test.sn',
      password: 'MotDePasse123456',
      role: 'SCHOOL_ADMIN',
      schoolId: school.id,
    });
    const { agent, csrf } = await loginAs('organisation@test.sn', 'MotDePasse123456');

    const response = await agent
      .post('/api/schooling/years')
      .set('x-csrf-token', csrf)
      .send({
        name: '2026-2027',
        startsAt: '2026-09-01T00:00:00.000Z',
        endsAt: '2027-07-31T23:59:59.999Z',
        status: 'PREPARATION',
      });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.year.semesters).toHaveLength(2);
    const [first, second] = response.body.year.semesters;
    expect(first.number).toBe(1);
    expect(second.number).toBe(2);
    expect(new Date(first.startsAt).getTime()).toBeLessThan(new Date(first.endsAt).getTime());
    expect(new Date(first.endsAt).getTime()).toBeLessThan(new Date(second.startsAt).getTime());
    expect(new Date(second.endsAt).getTime()).toBe(new Date('2027-07-31T23:59:59.999Z').getTime());
  });

  it('refuse une période de semestre hors année ou qui chevauche le second semestre', async () => {
    const school = await createSchool();
    await createUser({
      email: 'semestres@test.sn',
      password: 'MotDePasse123456',
      role: 'SCHOOL_ADMIN',
      schoolId: school.id,
    });
    const { agent, csrf } = await loginAs('semestres@test.sn', 'MotDePasse123456');
    const created = await agent
      .post('/api/schooling/years')
      .set('x-csrf-token', csrf)
      .send({
        name: '2026-2027',
        startsAt: '2026-09-01T00:00:00.000Z',
        endsAt: '2027-07-31T23:59:59.999Z',
      });
    const [first, second] = created.body.year.semesters;

    const overlap = await agent
      .patch(`/api/schooling/semesters/${first.id}`)
      .set('x-csrf-token', csrf)
      .send({
        startsAt: first.startsAt,
        endsAt: second.startsAt,
      });
    expect(overlap.status).toBe(409);

    const outsideYear = await agent
      .patch(`/api/schooling/semesters/${first.id}`)
      .set('x-csrf-token', csrf)
      .send({
        startsAt: '2026-08-31T00:00:00.000Z',
        endsAt: first.endsAt,
      });
    expect(outsideYear.status).toBe(400);
  });

  it('renvoie les affectations avec le niveau, la série et l’année de la classe (page Matières)', async () => {
    const school = await createSchool();
    await createUser({
      email: 'matieres@test.sn',
      password: 'MotDePasse123456',
      role: 'SCHOOL_ADMIN',
      schoolId: school.id,
    });
    const { agent, csrf } = await loginAs('matieres@test.sn', 'MotDePasse123456');

    const annee = await prisma.academicYear.create({
      data: {
        schoolId: school.id,
        name: '2026-2027',
        startsAt: new Date('2026-10-01'),
        endsAt: new Date('2027-07-31'),
        status: 'ACTIVE',
        semesters: {
          create: [
            { number: 1, name: 'Semestre 1', startsAt: new Date('2026-10-01'), endsAt: new Date('2027-02-28') },
            { number: 2, name: 'Semestre 2', startsAt: new Date('2027-03-01'), endsAt: new Date('2027-07-31') },
          ],
        },
      },
    });
    const niveau = await prisma.level.create({ data: { schoolId: school.id, name: 'Terminale S' } });
    const classe = await prisma.classroom.create({
      data: {
        schoolId: school.id,
        academicYearId: annee.id,
        levelId: niveau.id,
        name: 'TS 1',
      },
    });
    const discipline = await prisma.subject.create({
      data: { schoolId: school.id, name: 'Mathématiques', code: 'MATH' },
    });
    await prisma.classroomSubject.create({
      data: {
        schoolId: school.id,
        classroomId: classe.id,
        subjectId: discipline.id,
        coefficient: new Prisma.Decimal('3'),
      },
    });

    const response = await agent
      .get('/api/schooling/classroom-subjects')
      .set('x-csrf-token', csrf);

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.classroomSubjects).toHaveLength(1);
    const affectation = response.body.classroomSubjects[0];
    // Contrat attendu par la page Matières : sans ces champs, elle plante
    // (« Cannot read properties of undefined (reading 'name') »).
    expect(affectation.classroom.level.name).toBe('Terminale S');
    expect(affectation.classroom.academicYear.name).toBe('2026-2027');
    expect(affectation.classroom.series).toBeNull();
    expect(affectation.subject.name).toBe('Mathématiques');
    expect(affectation.coefficient).toBe('3');
  });
});
