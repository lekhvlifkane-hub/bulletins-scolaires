import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/db/prisma';
import { cleanTestDb, createSchool, createUser } from './helpers';

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

describe('Importation des élèves', () => {
  beforeEach(async () => {
    await cleanTestDb();
  });

  it('importe les lignes valides et rapporte les doublons et champs invalides', async () => {
    const school = await createSchool();
    await createUser({
      email: 'import-eleves@test.sn',
      password: 'MotDePasse123456',
      role: 'SCHOOL_ADMIN',
      schoolId: school.id,
    });
    await prisma.student.create({
      data: { schoolId: school.id, matricule: 'EXISTANT', lastName: 'Diallo', firstNames: 'Awa' },
    });
    const { agent, csrf } = await loginAs('import-eleves@test.sn', 'MotDePasse123456');

    const response = await agent
      .post('/api/students/import')
      .set('x-csrf-token', csrf)
      .send({
        students: [
          {
            row: 2,
            student: {
              matricule: 'NOUVEAU-1',
              lastName: 'Fall',
              firstNames: 'Mamadou',
              birthDate: '2012-04-03',
            },
          },
          {
            row: 3,
            student: {
              matricule: 'EXISTANT',
              lastName: 'Diallo',
              firstNames: 'Awa',
              birthDate: '2012-04-03',
            },
          },
          {
            row: 4,
            student: {
              matricule: 'NOUVEAU-1',
              lastName: 'Diop',
              firstNames: 'Moussa',
              birthDate: '2011-05-04',
            },
          },
          {
            row: 5,
            student: {
              matricule: 'INVALIDE',
              lastName: 'D',
              firstNames: 'Nom court',
              birthDate: '2010-01-01',
            },
          },
          {
            row: 6,
            student: {
              lastName: 'Sow',
              firstNames: 'Mariama',
              birthDate: '2013-08-15',
            },
          },
        ],
      });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.importedCount).toBe(2);
    expect(response.body.skippedCount).toBe(3);
    expect(response.body.results).toEqual([
      { row: 2, matricule: 'NOUVEAU-1', status: 'created' },
      {
        row: 3,
        matricule: 'EXISTANT',
        status: 'skipped',
        error: 'Doublon potentiel détecté; confirmez le rattachement à une fiche existante.',
      },
      {
        row: 4,
        matricule: 'NOUVEAU-1',
        status: 'skipped',
        error: 'Matricule répété dans le fichier',
      },
      expect.objectContaining({ row: 5, status: 'skipped' }),
      { row: 6, matricule: 'ELI001', status: 'created' },
    ]);

    const imported = await prisma.student.findFirst({
      where: { schoolId: school.id, matricule: 'NOUVEAU-1' },
    });
    expect(imported?.birthDate?.toISOString().slice(0, 10)).toBe('2012-04-03');
    const importedWithoutMatricule = await prisma.student.findFirst({
      where: { schoolId: school.id, lastName: 'Sow', firstNames: 'Mariama' },
    });
    expect(importedWithoutMatricule?.matricule).toBe('ELI001');
    const auditEntries = await prisma.auditLog.findMany({
      where: { schoolId: school.id, action: 'STUDENT_CREATED', entityId: imported?.id },
    });
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0].metadata).toEqual({ source: 'IMPORT', row: 2 });
  });

  it('requires explicit confirmation to link a matching student and preserves the matricule', async () => {
    const school = await createSchool();
    await createUser({
      email: 'import-doublon@test.sn',
      password: 'MotDePasse123456',
      role: 'SCHOOL_ADMIN',
      schoolId: school.id,
    });
    const student = await prisma.student.create({
      data: {
        schoolId: school.id,
        matricule: 'MAT-001',
        lastName: 'Fall',
        firstNames: 'Awa',
        birthDate: new Date('2012-04-03T00:00:00.000Z'),
      },
    });
    const year = await prisma.academicYear.create({
      data: {
        schoolId: school.id,
        name: '2026-2027',
        startsAt: new Date('2026-09-01T00:00:00.000Z'),
        endsAt: new Date('2027-07-31T23:59:59.999Z'),
        status: 'ACTIVE',
      },
    });
    const level = await prisma.level.create({ data: { schoolId: school.id, name: '6e' } });
    const classroom = await prisma.classroom.create({
      data: { schoolId: school.id, academicYearId: year.id, levelId: level.id, name: '6e A' },
    });
    const { agent, csrf } = await loginAs('import-doublon@test.sn', 'MotDePasse123456');
    const row = {
      row: 2,
      student: {
        lastName: 'Fall',
        firstNames: 'Awa',
        birthDate: '2012-04-03',
        classroom: '6e A',
        academicYear: '2026-2027',
        status: 'REDOUBLANT',
      },
    };

    const preview = await agent
      .post('/api/students/import/preview')
      .set('x-csrf-token', csrf)
      .send({ students: [row] });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.rows[0].status).toBe('DUPLICATE');
    expect(preview.body.rows[0].candidates[0].id).toBe(student.id);

    const unconfirmed = await agent
      .post('/api/students/import')
      .set('x-csrf-token', csrf)
      .send({ students: [row] });
    expect(unconfirmed.status, JSON.stringify(unconfirmed.body)).toBe(201);
    expect(unconfirmed.body.results[0].status).toBe('skipped');
    expect(await prisma.student.count({ where: { schoolId: school.id } })).toBe(1);
    expect(await prisma.enrollment.count({ where: { schoolId: school.id } })).toBe(0);

    const confirmed = await agent
      .post('/api/students/import')
      .set('x-csrf-token', csrf)
      .send({
        students: [{ ...row, action: 'LINK', candidateId: student.id }],
      });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(201);
    expect(confirmed.body).toMatchObject({ createdCount: 0, linkedCount: 1, skippedCount: 0 });
    expect(confirmed.body.results[0]).toMatchObject({
      row: 2,
      matricule: 'MAT-001',
      status: 'linked',
    });

    const enrollments = await prisma.enrollment.findMany({ where: { studentId: student.id } });
    expect(enrollments).toHaveLength(1);
    expect(enrollments[0]).toMatchObject({
      classroomId: classroom.id,
      isRepeating: true,
      entryType: 'NEW',
    });
    expect(await prisma.student.count({ where: { schoolId: school.id } })).toBe(1);
    expect((await prisma.student.findUnique({ where: { id: student.id } }))?.matricule).toBe('MAT-001');
  });

  it('limite les imports à 500 élèves', async () => {
    const school = await createSchool();
    await createUser({
      email: 'import-limite@test.sn',
      password: 'MotDePasse123456',
      role: 'SCHOOL_ADMIN',
      schoolId: school.id,
    });
    const { agent, csrf } = await loginAs('import-limite@test.sn', 'MotDePasse123456');

    const response = await agent
      .post('/api/students/import')
      .set('x-csrf-token', csrf)
      .send({
        students: Array.from({ length: 501 }, (_, index) => ({
          row: index + 2,
          student: { matricule: `EL-${index}`, lastName: 'Nom', firstNames: 'Prenom' },
        })),
      });
    expect(response.status).toBe(400);
    expect(await prisma.student.count({ where: { schoolId: school.id } })).toBe(0);
  });
});
