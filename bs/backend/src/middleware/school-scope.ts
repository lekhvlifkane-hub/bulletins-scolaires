import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db/prisma';
import { asyncHandler, HttpError } from '../lib/http';

function requestedSchoolId(req: Request): string | undefined {
  const fromQuery = typeof req.query.schoolId === 'string' ? req.query.schoolId : undefined;
  const fromBody =
    req.body && typeof req.body.schoolId === 'string' ? req.body.schoolId : undefined;
  const fromParams =
    typeof req.params.schoolId === 'string' ? req.params.schoolId : undefined;
  return fromQuery ?? fromBody ?? fromParams;
}

export async function hasActivePlatformGrant(
  userId: string,
  schoolId: string,
): Promise<boolean> {
  const now = new Date();
  const grant = await prisma.temporaryAccessGrant.findFirst({
    where: {
      schoolId,
      platformAdminId: userId,
      revokedAt: null,
      startsAt: { lte: now },
      expiresAt: { gt: now },
    },
  });
  return Boolean(grant);
}

export async function assertPlatformAccess(
  userId: string,
  schoolId: string,
): Promise<void> {
  const allowed = await hasActivePlatformGrant(userId, schoolId);
  if (!allowed) {
    throw new HttpError(
      403,
      "Un accès temporaire actif est requis pour consulter cet établissement",
    );
  }
}

export const requireSchoolScope = asyncHandler(async (req, res, next) => {
  const user = req.currentUser;
  if (!user) {
    throw new HttpError(401, 'Authentification requise');
  }

  if (user.role !== 'PLATFORM_ADMIN') {
    if (!user.schoolId) {
      throw new HttpError(403, "Aucun établissement n'est associé à ce compte");
    }

    const requested = requestedSchoolId(req);
    if (requested && requested !== user.schoolId) {
      throw new HttpError(403, 'Accès refusé à cet établissement');
    }

    req.schoolScopeId = user.schoolId;
    next();
    return;
  }

  const schoolId = requestedSchoolId(req);
  if (!schoolId) {
    throw new HttpError(
      400,
      "Le paramètre schoolId est requis pour un administrateur plateforme",
    );
  }

  const now = new Date();
  const grant = await prisma.temporaryAccessGrant.findFirst({
    where: {
      schoolId,
      platformAdminId: user.id,
      revokedAt: null,
      startsAt: { lte: now },
      expiresAt: { gt: now },
    },
  });

  if (!grant) {
    throw new HttpError(
      403,
      "Un accès temporaire actif est requis pour consulter cet établissement",
    );
  }

  req.schoolScopeId = schoolId;
  next();
});
