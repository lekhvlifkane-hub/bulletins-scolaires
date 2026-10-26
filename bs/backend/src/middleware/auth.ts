import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from '../db/prisma';
import { asyncHandler, HttpError } from '../lib/http';
import { destroySession } from '../lib/session';

export const requireAuth = asyncHandler(async (req, res, next) => {
  if (!req.session.userId) {
    throw new HttpError(401, 'Authentification requise');
  }

  const user = await prisma.user.findFirst({
    where: {
      id: req.session.userId,
      deletedAt: null,
      isActive: true,
    },
    include: { school: true },
  });

  if (!user) {
    await destroySession(req).catch(() => undefined);
    throw new HttpError(401, 'Session expirée, veuillez vous reconnecter');
  }

  req.currentUser = user;
  req.currentSchool = user.school;
  next();
});

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.currentUser;
    if (!user) {
      next(new HttpError(401, 'Authentification requise'));
      return;
    }
    if (!roles.includes(user.role)) {
      next(new HttpError(403, 'Permissions insuffisantes pour cette action'));
      return;
    }
    next();
  };
}

export function requireSchoolId(req: Request): string {
  const schoolId = req.currentUser?.schoolId;
  if (!schoolId) {
    throw new HttpError(403, "Aucun établissement n'est associé à ce compte");
  }
  return schoolId;
}
