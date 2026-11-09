import request from 'supertest';
import { createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import app from '../src/app';
import { env } from '../src/config/env';
import { pool } from '../src/db/pool';
import { HttpError } from '../src/lib/http';
import { errorHandler } from '../src/middleware/error-handler';

/** Le service était injoignable : signature exacte de l'incident production. */
const erreurConnexionRailway = () =>
  new AggregateError([
    Object.assign(new Error('connect ETIMEDOUT 10.174.68.83:5432'), { code: 'ETIMEDOUT' }),
    Object.assign(
      new Error('connect ECONNREFUSED fd12:4346:f503:1:b000:81:6ae:4453:5432'),
      { code: 'ECONNREFUSED' },
    ),
  ]);

/**
 * Reproduit le format de signature de cookie-signature (dépendance de
 * express-session, sans typage public) : HMAC-SHA256 en base64 sans padding.
 */
function sidSigne(sid: string, secret: string): string {
  const mac = createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
  return `${sid}.${mac}`;
}

type ReponseFantome = {
  res: Response;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
};

function reponseFantome(headersSent = false): ReponseFantome {
  const status = vi.fn().mockReturnThis();
  const json = vi.fn();
  const res = { headersSent, status, json } as unknown as Response;
  return { res, status, json };
}

function exec(error: unknown, res: Response, next: NextFunction): void {
  errorHandler(error, {} as Request, res, next);
}

describe('errorHandler', () => {
  it("délègue à Express sans réécrire d'en-têtes quand la réponse est déjà partie", () => {
    const { res, status, json } = reponseFantome(true);
    const next = vi.fn();

    expect(() => exec(new HttpError(500, 'boom'), res, next as NextFunction)).not.toThrow();

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });

  it('traduit un AggregateError de connexion (IPv4 + IPv6) en 503', () => {
    const { res, status, json } = reponseFantome();
    const next = vi.fn();

    exec(erreurConnexionRailway(), res, next as NextFunction);

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({ error: 'Service temporairement indisponible' });
    expect(next).not.toHaveBeenCalled();
  });

  it('traduit les deux messages de timeout de pg (sans code) en 503', () => {
    const messages = [
      'timeout exceeded when trying to connect', // pg-pool, acquisition de client
      'Connection terminated due to connection timeout', // pg Client, connect
    ];

    for (const message of messages) {
      const { res, status, json } = reponseFantome();
      const next = vi.fn();

      exec(new Error(message), res, next as NextFunction);

      expect(status, message).toHaveBeenCalledWith(503);
      expect(json, message).toHaveBeenCalledWith({ error: 'Service temporairement indisponible' });
    }
  });

  it('extrait aussi les codes enfouis dans `.cause` (chaîne d\u2019erreurs)', () => {
    const { res, status } = reponseFantome();
    const next = vi.fn();
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
      code: 'ECONNREFUSED',
    });

    exec(new Error('Échec du store de session', { cause }), res, next as NextFunction);

    expect(status).toHaveBeenCalledWith(503);
  });

  it('garde la réponse 400 pour une erreur Zod', () => {
    const { res, status, json } = reponseFantome();
    const next = vi.fn();
    const zodError = Object.assign(new Error('Données invalides'), { issues: [] });

    exec(zodError, res, next as NextFunction);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: 'Données invalides', details: [] });
  });

  it('garde la réponse 500 pour une erreur inconnue', () => {
    const { res, status, json } = reponseFantome();
    const next = vi.fn();

    exec(new Error('crash inattendu'), res, next as NextFunction);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: 'Erreur interne du serveur' });
  });
});

describe('CORS', () => {
  it('répond 403 pour une origine étrangère (et non 500 « Erreur non gérée »)', async () => {
    const response = await request(app)
      .get('/api/health')
      .set('Origin', 'https://exemple-etranger.example');

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Origine non autorisée par CORS');
  });

  it('laisse passer une origine locale autorisée', async () => {
    const response = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});

describe('Panne de la base de sessions (réplique de l\u2019incident production)', () => {
  it('répond 503 quand un sid signé pointe vers un store injoignable', async () => {
    const originalQuery = pool.query.bind(pool);
    // La sleeve privée `#pool` de connect-pg-simple appelle `pool.query`
    // dynamiquement : ce monkey-patch intercepte test de table + lecture.
    pool.query = (async () => {
      throw erreurConnexionRailway();
    }) as unknown as typeof pool.query;

    try {
      const sid = `test-store-injoignable-${randomUUID()}`;
      const valeurCookie = `s:${sidSigne(sid, env.SESSION_SECRET)}`;
      const response = await request(app)
        .get('/api/health')
        .set('Cookie', `${env.SESSION_COOKIE_NAME}=${encodeURIComponent(valeurCookie)}`);

      expect(response.status).toBe(503);
      expect(response.body).toEqual({ error: 'Service temporairement indisponible' });
    } finally {
      pool.query = originalQuery;
    }
  });
});
