import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/http';

/**
 * Codes de transport réseau : base injoignable, socket coupée, DNS muet.
 * Constaté en production (Railway, 2026-11-09) : un AggregateError avec
 * `ETIMEDOUT` (IPv4) + `ECONNREFUSED` (IPv6) faisait répondre 500 à chaque
 * requête avec cookie de session, au lieu d'un 503 de service indisponible.
 */
const CONNECTION_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

// Messages des timeouts de connexion pg (sans code `.code`, pas même dans
// `.cause`) : pg-pool en checkout ou pg Client en tentative de connexion.
const PG_CONNECTION_TIMEOUT_MESSAGES = [
  'timeout exceeded when trying to connect',
  'Connection terminated due to connection timeout',
];

/**
 * Cherche un code de connexion dans l'arbre d'erreurs : pg renvoie un
 * AggregateError (tentatives IPv4 + IPv6, Happy Eyeballs) dont les codes se
 * trouvent dans `.errors` ; certaines erreurs les placent dans `.cause`.
 */
function findConnectionErrorCode(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const code = (error as NodeJS.ErrnoException).code;
  if (typeof code === 'string' && CONNECTION_ERROR_CODES.has(code)) {
    return code;
  }

  if (PG_CONNECTION_TIMEOUT_MESSAGES.some((message) => error.message.includes(message))) {
    return 'PG_CONNECTION_TIMEOUT';
  }

  const aggregateErrors = (error as AggregateError).errors;
  if (Array.isArray(aggregateErrors)) {
    for (const nestedError of aggregateErrors) {
      const nestedCode = findConnectionErrorCode(nestedError);
      if (nestedCode !== null) {
        return nestedCode;
      }
    }
  }

  const cause = (error as { cause?: unknown }).cause;
  if (cause !== undefined) {
    return findConnectionErrorCode(cause);
  }

  return null;
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  // La réponse est déjà partie (ex. double échec du store de session) :
  // réécrire des en-têtes déclencherait ERR_HTTP_HEADERS_SENT.
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, details: error.details });
    return;
  }

  if (error instanceof Error) {
    const zodError = error as { issues?: unknown };
    if (Array.isArray(zodError.issues)) {
      res.status(400).json({ error: 'Données invalides', details: zodError.issues });
      return;
    }
  }

  if (findConnectionErrorCode(error)) {
    console.error('Service indisponible (échec de connexion réseau)', error);
    res.status(503).json({ error: 'Service temporairement indisponible' });
    return;
  }

  console.error('Erreur non gérée', error);
  res.status(500).json({ error: 'Erreur interne du serveur' });
}
