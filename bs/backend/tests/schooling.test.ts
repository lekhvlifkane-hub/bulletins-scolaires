import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app';
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
});
