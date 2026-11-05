import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/db/prisma';
import { cleanTestDb, createSchool, createUser } from './helpers';

async function loginAs(email: string) {
  const agent = request.agent(app);
  const session = await agent.get('/api/auth/session');
  const csrf = session.body.csrfToken as string;
  const login = await agent.post('/api/auth/login')
    .set('x-csrf-token', csrf)
    .send({ email, password: 'MotDePasse123456' });
  return { agent, csrf: (login.body.csrfToken as string | undefined) ?? csrf };
}

describe('Transfert et archivage des élèves', () => {
  beforeEach(async () => {
    await cleanTestDb();
  });

  async function setup() {
    const school = await createSchool();
    await createUser({
      email: 'cycle-eleve@test.sn',
      password: 'MotDePasse123456',
      role: 'SCHOOL_ADMIN',
      schoolId: school.id,
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
    const level = await prisma.level.create({
      data: { schoolId: school.id, name: '6e' },
    });
    const firstClass = await prisma.classroom.create({
      data: { schoolId: school.id, academicYearId: year.id, levelId: level.id, name: '6e A' },
    });
    const secondClass = await prisma.classroom.create({
      data: { schoolId: school.id, academicYearId: year.id, levelId: level.id, name: '6e B' },
    });
    const student = await prisma.student.create({
      data: { schoolId: school.id, matricule: 'EL-1', lastName: 'Fall', firstNames: 'Awa' },
    });
    const enrollment = await prisma.enrollment.create({
      data: { schoolId: school.id, studentId: student.id, classroomId: firstClass.id },
    });
    const { agent, csrf } = await loginAs('cycle-eleve@test.sn');
    return { school, student, firstClass, secondClass, enrollment, agent, csrf };
  }

  it('transfers to a new class and rejects a duplicate transfer to the current class', async () => {
    const { student, firstClass, secondClass, agent, csrf } = await setup();
    const response = await agent
      .post(`/api/students/${student.id}/enrollments`)
      .set('x-csrf-token', csrf)
      .send({ classroomId: secondClass.id });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const enrollments = await prisma.enrollment.findMany({
      where: { studentId: student.id },
      orderBy: { enrolledAt: 'asc' },
    });
    expect(enrollments).toHaveLength(2);
    expect(enrollments[0].classroomId).toBe(firstClass.id);
    expect(enrollments[0].status).toBe('TRANSFERRED');
    expect(enrollments[0].endedAt).toBeInstanceOf(Date);
    expect(enrollments[1].classroomId).toBe(secondClass.id);
    expect(enrollments[1].status).toBe('ACTIVE');

    const duplicate = await agent
      .post(`/api/students/${student.id}/enrollments`)
      .set('x-csrf-token', csrf)
      .send({ classroomId: secondClass.id });
    expect(duplicate.status).toBe(409);
    expect(await prisma.enrollment.count({ where: { studentId: student.id } })).toBe(2);
  });

  it('archives the student and closes the active enrollment without deleting its history', async () => {
    const { student, firstClass, agent, csrf } = await setup();
    const response = await agent
      .delete(`/api/students/${student.id}`)
      .set('x-csrf-token', csrf);

    expect(response.status).toBe(204);
    const archivedStudent = await prisma.student.findUnique({ where: { id: student.id } });
    expect(archivedStudent?.deletedAt).toBeInstanceOf(Date);
    const enrollments = await prisma.enrollment.findMany({ where: { studentId: student.id } });
    expect(enrollments).toHaveLength(1);
    expect(enrollments[0].classroomId).toBe(firstClass.id);
    expect(enrollments[0].status).toBe('TRANSFERRED');
    expect(enrollments[0].endedAt).toBeInstanceOf(Date);
    expect(await prisma.enrollment.count({
      where: { studentId: student.id, status: 'ACTIVE', deletedAt: null },
    })).toBe(0);

    const detail = await agent.get(`/api/students/${student.id}`);
    expect(detail.status).toBe(404);
  });
});
