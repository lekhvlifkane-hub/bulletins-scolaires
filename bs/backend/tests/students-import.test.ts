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

describe('Import CSV des élèves', () => {
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
            student: { matricule: 'EXISTANT', lastName: 'Diallo', firstNames: 'Awa' },
          },
          {
            row: 4,
            student: { matricule: 'NOUVEAU-1', lastName: 'Diop', firstNames: 'Moussa' },
          },
          {
            row: 5,
            student: { matricule: 'INVALIDE', lastName: 'D', firstNames: 'Nom court' },
          },
        ],
      });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.importedCount).toBe(1);
    expect(response.body.skippedCount).toBe(3);
    expect(response.body.results).toEqual([
      { row: 2, matricule: 'NOUVEAU-1', status: 'created' },
      {
        row: 3,
        matricule: 'EXISTANT',
        status: 'skipped',
        error: 'Ce matricule existe déjà dans cet établissement',
      },
      {
        row: 4,
        matricule: 'NOUVEAU-1',
        status: 'skipped',
        error: 'Matricule répété dans le fichier',
      },
      expect.objectContaining({ row: 5, matricule: 'INVALIDE', status: 'skipped' }),
    ]);

    const imported = await prisma.student.findFirst({
      where: { schoolId: school.id, matricule: 'NOUVEAU-1' },
    });
    expect(imported?.birthDate?.toISOString().slice(0, 10)).toBe('2012-04-03');
    const auditEntries = await prisma.auditLog.findMany({
      where: { schoolId: school.id, action: 'STUDENT_CREATED', entityId: imported?.id },
    });
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0].metadata).toEqual({ source: 'CSV', row: 2 });
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
