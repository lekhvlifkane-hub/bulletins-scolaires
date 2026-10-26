import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function ensureCsrfToken(req: Request): string {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

export function rotateCsrfToken(req: Request): string {
  req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  return req.session.csrfToken;
}

export function requireCsrf(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const provided = req.get(CSRF_HEADER);
  const expected = req.session.csrfToken;

  if (
    !provided ||
    !expected ||
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  ) {
    res.status(403).json({ error: 'Jeton CSRF invalide ou expiré' });
    return;
  }

  next();
}
