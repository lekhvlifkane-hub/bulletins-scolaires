import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/app';
import { cleanTestDb, createSchool, createUser } from './helpers';
import { prisma } from '../src/db/prisma';

describe('Authentification', () => {
  beforeEach(async () => {
    await cleanTestDb();
  });

  it('retourne session non authentifiée avec CSRF', async () => {
    const res = await request(app).get('/api/auth/session');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
    expect(typeof res.body.csrfToken).toBe('string');
  });

  it('refuse login avec identifiants invalides', async () => {
    const agent = request.agent(app);
    const session = await agent.get('/api/auth/session');
    const csrf = session.body.csrfToken;

    const res = await agent
      .post('/api/auth/login')
      .set('x-csrf-token', csrf)
      .send({ email: 'inconnu@test.sn', password: 'MotDePasse123456' });

    expect([401, 403]).toContain(res.status);
  });

  it('authentifie un utilisateur valide et renvoie le profil', async () => {
    const school = await createSchool();
    const user = await createUser({
      email: 'admin@ecole.sn',
      password: 'MotDePasse123456',
      role: 'SCHOOL_ADMIN',
      schoolId: school.id,
    });

    const session = await request(app).get('/api/auth/session');
    const csrf = session.body.csrfToken;
    const cookie = session.headers['set-cookie'];

    const login = await request(app)
      .post('/api/auth/login')
      .set('Cookie', cookie)
      .set('x-csrf-token', csrf)
      .send({ email: 'admin@ecole.sn', password: 'MotDePasse123456' });

    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe('admin@ecole.sn');
    expect(login.body.user.role).toBe('SCHOOL_ADMIN');
    expect(login.body.school.id).toBe(school.id);
    expect(typeof login.body.csrfToken).toBe('string');
  });

  it('verrouille après 5 échecs', async () => {
    const school = await createSchool();
    await createUser({
      email: 'locked@ecole.sn',
      password: 'MotDePasse123456',
      role: 'ASSISTANT',
      schoolId: school.id,
    });

    const session = await request(app).get('/api/auth/session');
    const csrf = session.body.csrfToken;
    const cookie = session.headers['set-cookie'];

    for (let i = 0; i < 5; i += 1) {
      await request(app)
        .post('/api/auth/login')
        .set('Cookie', cookie)
        .set('x-csrf-token', csrf)
        .send({ email: 'locked@ecole.sn', password: 'mauvais' });
    }

    const blocked = await request(app)
      .post('/api/auth/login')
      .set('Cookie', cookie)
      .set('x-csrf-token', csrf)
      .send({ email: 'locked@ecole.sn', password: 'mauvais' });

    expect([423, 429]).toContain(blocked.status);
  });

  it('refuse les requêtes mutantes sans CSRF', async () => {
    const school = await createSchool();
    await createUser({
      email: 'nocrsf@ecole.sn',
      password: 'MotDePasse123456',
      role: 'SCHOOL_ADMIN',
      schoolId: school.id,
    });

    const session = await request(app).get('/api/auth/session');
    const csrf = session.body.csrfToken;
    const cookie = session.headers['set-cookie'];

    await request(app)
      .post('/api/auth/login')
      .set('Cookie', cookie)
      .set('x-csrf-token', csrf)
      .send({ email: 'nocrsf@ecole.sn', password: 'MotDePasse123456' });

    const res = await request(app).post('/api/auth/logout').send({});
    expect(res.status).toBe(403);
  });
});
