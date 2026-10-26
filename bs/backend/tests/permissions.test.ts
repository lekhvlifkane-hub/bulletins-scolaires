import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/db/prisma';
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

describe('Permissions et isolation', () => {
  beforeEach(async () => {
    await cleanTestDb();
  });

  it('un utilisateur école ne peut pas lister les établissements', async () => {
    const school = await createSchool();
    await createUser({
      email: 'admin@e1.sn',
      password: 'MotDePasse123456',
      role: 'SCHOOL_ADMIN',
      schoolId: school.id,
    });

      const agent = request.agent(app);
      const session = await agent.get('/api/auth/session');
      const csrf = session.body.csrfToken;
      await agent
        .post('/api/auth/login')
        .set('x-csrf-token', csrf)
        .send({ email: 'admin@e1.sn', password: 'MotDePasse123456' });

      const me = await agent.get('/api/auth/session');
      const res = await agent
        .get('/api/schools')
        .set('x-csrf-token', me.body.csrfToken);

      expect(res.status).toBe(403);
  });

  it('les indicateurs du tableau de bord restent isolés par établissement', async () => {
    const schoolA = await createSchool('École indicateurs A');
    const schoolB = await createSchool('École indicateurs B');
    await prisma.student.createMany({
      data: [
        { schoolId: schoolA.id, matricule: 'A-001', lastName: 'Élève', firstNames: 'A' },
        { schoolId: schoolB.id, matricule: 'B-001', lastName: 'Élève', firstNames: 'B' },
      ],
    });
    await createUser({
      email: 'dashboard@school-a.sn',
      password: 'MotDePasse123456',
      role: 'SCHOOL_ADMIN',
      schoolId: schoolA.id,
    });

    const { agent } = await loginAs('dashboard@school-a.sn', 'MotDePasse123456');
    const response = await agent.get('/api/dashboard');

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.scope).toBe('school');
    expect(response.body.schoolName).toBe(schoolA.name);
    expect(response.body.indicators.students).toBe(1);
  });

  it('réserve les indicateurs de plateforme à un compte authentifié', async () => {
    const withoutSession = await request(app).get('/api/dashboard');
    expect(withoutSession.status).toBe(401);

    await createUser({
      email: 'dashboard-platform@test.sn',
      password: 'MotDePasse123456',
      role: 'PLATFORM_ADMIN',
      schoolId: null,
    });
    const { agent } = await loginAs('dashboard-platform@test.sn', 'MotDePasse123456');
    const response = await agent.get('/api/dashboard');

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.scope).toBe('platform');
    expect(response.body.indicators).toEqual(expect.objectContaining({
      schools: expect.any(Number),
      activeSchools: expect.any(Number),
      users: expect.any(Number),
    }));
  });

  it('un utilisateur école ne peut pas accéder à un autre établissement', async () => {
    const e1 = await createSchool('Ecole 1');
    const e2 = await createSchool('Ecole 2');
    await createUser({
      email: 'admin@e1.sn',
      password: 'MotDePasse123456',
      role: 'SCHOOL_ADMIN',
      schoolId: e1.id,
    });

    const agent = request.agent(app);
    const session = await agent.get('/api/auth/session');
    const csrf = session.body.csrfToken;
    await agent
      .post('/api/auth/login')
      .set('x-csrf-token', csrf)
      .send({ email: 'admin@e1.sn', password: 'MotDePasse123456' });

    const me = await agent.get('/api/auth/session');
    const res = await agent
      .get(`/api/schools/${e2.id}`)
      .set('x-csrf-token', me.body.csrfToken);

    expect(res.status).toBe(403);
  });

  it("un PLATFORM_ADMIN ne peut pas accéder sans accès temporaire actif", async () => {
    const e1 = await createSchool('Ecole 1');
    await createUser({
      email: 'platform@test.sn',
      password: 'MotDePasse123456',
      role: 'PLATFORM_ADMIN',
      schoolId: null,
    });

      const agent = request.agent(app);
      const session = await agent.get('/api/auth/session');
      const csrf = session.body.csrfToken;
      await agent
        .post('/api/auth/login')
        .set('x-csrf-token', csrf)
        .send({ email: 'platform@test.sn', password: 'MotDePasse123456' });

      const me = await agent.get('/api/auth/session');
      const res = await agent
        .get(`/api/schools/${e1.id}`)
        .set('x-csrf-token', me.body.csrfToken);

      expect(res.status).toBe(403);
  });

  it("un PLATFORM_ADMIN accède avec un accès temporaire actif", async () => {
    const e1 = await createSchool('Ecole 1');
    const platform = await createUser({
      email: 'platform@test.sn',
      password: 'MotDePasse123456',
      role: 'PLATFORM_ADMIN',
      schoolId: null,
    });

    const { prisma } = await import('../src/db/prisma');
    await prisma.temporaryAccessGrant.create({
      data: {
        schoolId: e1.id,
        platformAdminId: platform.id,
        grantedById: platform.id,
        reason: 'Support',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const agent = request.agent(app);
    const session = await agent.get('/api/auth/session');
    const csrf = session.body.csrfToken;
    await agent
      .post('/api/auth/login')
      .set('x-csrf-token', csrf)
      .send({ email: 'platform@test.sn', password: 'MotDePasse123456' });

    const me = await agent.get('/api/auth/session');
    const res = await agent
      .get(`/api/schools/${e1.id}`)
      .set('x-csrf-token', me.body.csrfToken);

    expect(res.status).toBe(200);
    expect(res.body.school.id).toBe(e1.id);
  });

  it("un SCHOOL_ADMIN ne peut pas créer un autre SCHOOL_ADMIN différent", async () => {
    const e1 = await createSchool('Ecole 1');
    await createUser({
      email: 'admin@e1.sn',
      password: 'MotDePasse123456',
      role: 'SCHOOL_ADMIN',
      schoolId: e1.id,
    });

    const agent = request.agent(app);
    const session = await agent.get('/api/auth/session');
    const csrf = session.body.csrfToken;
    await agent
      .post('/api/auth/login')
      .set('x-csrf-token', csrf)
      .send({ email: 'admin@e1.sn', password: 'MotDePasse123456' });

    const me = await agent.get('/api/auth/session');
    const res = await agent
      .post('/api/users')
      .set('x-csrf-token', me.body.csrfToken)
      .send({ name: 'Autre Admin', email: 'other@e1.sn', role: 'SCHOOL_ADMIN' });

    expect([400, 403]).toContain(res.status);
  });

  it("un SCHOOL_ADMIN peut créer un ASSISTANT dans son établissement", async () => {
    const e1 = await createSchool('Ecole 1');
    await createUser({
      email: 'admin@e1.sn',
      password: 'MotDePasse123456',
      role: 'SCHOOL_ADMIN',
      schoolId: e1.id,
    });

      const agent = request.agent(app);
      const session = await agent.get('/api/auth/session');
      const csrf = session.body.csrfToken;
      await agent
        .post('/api/auth/login')
        .set('x-csrf-token', csrf)
        .send({ email: 'admin@e1.sn', password: 'MotDePasse123456' });

      const me = await agent.get('/api/auth/session');
      const res = await agent
        .post('/api/users')
        .set('x-csrf-token', me.body.csrfToken)
        .send({ name: 'Assistant', email: 'assist@e1.sn', role: 'ASSISTANT' });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('ASSISTANT');
    expect(res.body.user.schoolId).toBe(e1.id);
  });

  it("un SCHOOL_ADMIN peut accorder un accès temporaire à un PLATFORM_ADMIN", async () => {
    const school = await createSchool('École accès temporaire');
    await createUser({
      email: 'admin@ecole.sn',
      password: 'MotDePasse123456',
      role: 'SCHOOL_ADMIN',
      schoolId: school.id,
    });
    await createUser({
      email: 'plateforme@ecole.sn',
      password: 'MotDePasse123456',
      role: 'PLATFORM_ADMIN',
      schoolId: null,
    });

    const schoolAdmin = await loginAs('admin@ecole.sn', 'MotDePasse123456');
    const grant = await schoolAdmin.agent
      .post('/api/temporary-access')
      .set('x-csrf-token', schoolAdmin.csrf)
      .send({
        email: 'plateforme@ecole.sn',
        reason: 'Assistance technique',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });

    expect(grant.status).toBe(201);

    const platformAdmin = await loginAs('plateforme@ecole.sn', 'MotDePasse123456');
    const grants = await platformAdmin.agent
      .get(`/api/temporary-access?schoolId=${school.id}`)
      .set('x-csrf-token', platformAdmin.csrf);

    expect(grants.status).toBe(200);
    expect(grants.body.grants).toHaveLength(1);
    expect(grants.body.grants[0].school.id).toBe(school.id);
  });
});
