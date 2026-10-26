import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/http';

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
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

  console.error('Erreur non gérée', error);
  res.status(500).json({ error: 'Erreur interne du serveur' });
}
