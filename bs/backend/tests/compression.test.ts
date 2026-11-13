import http from 'node:http';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app';

/**
 * Le middleware compression n'agit que si le client annonce `Accept-Encoding:
 * gzip` ; superagent (derrière supertest) décompresse alors de façon
 * transparente et masque l'en-tête. On teste donc avec une requête HTTP brute
 * pour observer ce que verrait réellement le navigateur de l'établissement.
 */

let serveur: http.Server;
let origine: string;

beforeAll(async () => {
  serveur = http.createServer(app);
  await new Promise<void>((resoudre) => serveur.listen(0, '127.0.0.1', resoudre));
  origine = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resoudre) => serveur.close(() => resoudre()));
});

function requeteBrute(chemin: string, entetes: Record<string, string>) {
  return new Promise<{ status?: number; entetes: http.IncomingHttpHeaders; corps: Buffer }>(
    (resoudre, rejeter) => {
      const demande = http.request(`${origine}${chemin}`, { headers: entetes }, (reponse) => {
        const morceaux: Buffer[] = [];
        reponse.on('data', (morceau: Buffer) => morceaux.push(morceau));
        reponse.on('end', () =>
          resoudre({
            status: reponse.statusCode,
            entetes: reponse.headers,
            corps: Buffer.concat(morceaux),
          }),
        );
      });
      demande.on('error', rejeter);
      demande.end();
    },
  );
}

describe('Compression gzip des réponses', () => {
  it('compresse les JSON au-delà du seuil (1 ko) quand le client accepte gzip', async () => {
    // /api/health est trop petit (~16 octets) pour dépasser le seuil du
    // middleware ; la spécification OpenAPI, elle, fait plusieurs dizaines de ko.
    const reponse = await requeteBrute('/api/docs.json', { 'Accept-Encoding': 'gzip' });

    expect(reponse.status).toBe(200);
    expect(reponse.entetes['content-encoding']).toBe('gzip');

    const decompresse = await new Promise<Buffer>((resoudre, rejeter) =>
      zlib.gunzip(reponse.corps, (erreur, resultat) => (erreur ? rejeter(erreur) : resoudre(resultat))),
    );
    const spec = JSON.parse(decompresse.toString('utf8')) as { info: { title: string } };
    expect(spec.info.title).toBe('Bulletins Scolaires API');
  });

  it('ne compresse pas quand le client n’annonce pas gzip', async () => {
    const reponse = await requeteBrute('/api/docs.json', {});

    expect(reponse.status).toBe(200);
    expect(reponse.entetes['content-encoding']).toBeUndefined();
  });

  it('laisse passer les réponses sous le seuil sans les compresser', async () => {
    const reponse = await requeteBrute('/api/health', { 'Accept-Encoding': 'gzip' });

    expect(reponse.status).toBe(200);
    expect(reponse.entetes['content-encoding']).toBeUndefined();
    expect(JSON.parse(reponse.corps.toString('utf8'))).toEqual({ status: 'ok' });
  });
});
