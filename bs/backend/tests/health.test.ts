import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../src/app';

describe('GET /api/health', () => {
  it('répond 200 avec le statut ok', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});

describe('Documentation OpenAPI', () => {
  it('sert le document OpenAPI en JSON', async () => {
    const response = await request(app).get('/api/docs.json');

    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe('3.0.3');
    expect(response.body.info.title).toBe('Bulletins Scolaires API');
    expect(response.body.paths['/api/health'].get).toBeDefined();
  });

  it('sert l’interface Swagger UI', async () => {
    const response = await request(app).get('/api/docs/');

    expect(response.status).toBe(200);
    expect(response.text).toContain('Swagger UI');
  });
});
