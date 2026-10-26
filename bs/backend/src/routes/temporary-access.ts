import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { asyncHandler, HttpError } from '../lib/http';
import { requireAuth, requireRole } from '../middleware/auth';
import { assertPlatformAccess } from '../middleware/school-scope';
import { writeAuditLog } from '../services/audit';
import { requireCsrf } from '../lib/csrf';

const router = Router();

const grantSchema = z.object({
  schoolId: z.string().min(1).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  reason: z.string().trim().min(3, 'Motif requis'),
  expiresAt: z.coerce.date(),
});

function serializeGrant(grant: {
  id: string;
  school: { id: string; name: string };
  platformAdmin: { id: string; name: string; email: string };
  grantedBy: { id: string; name: string };
  reason: string;
  startsAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}) {
  const now = new Date();
  return {
    id: grant.id,
    school: { id: grant.school.id, name: grant.school.name },
    platformAdmin: {
      id: grant.platformAdmin.id,
      name: grant.platformAdmin.name,
      email: grant.platformAdmin.email,
    },
    grantedBy: { id: grant.grantedBy.id, name: grant.grantedBy.name },
    reason: grant.reason,
    startsAt: grant.startsAt,
    expiresAt: grant.expiresAt,
    active: !grant.revokedAt && grant.startsAt <= now && grant.expiresAt > now,
  };
}

router.use(requireAuth, requireRole('PLATFORM_ADMIN', 'SCHOOL_ADMIN'), requireCsrf);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const actor = req.currentUser!;
    const requestedSchoolId =
      typeof req.query.schoolId === 'string' ? req.query.schoolId : undefined;

    let where;
    if (actor.role === 'PLATFORM_ADMIN' && requestedSchoolId) {
      await assertPlatformAccess(actor.id, requestedSchoolId);
      where = { schoolId: requestedSchoolId };
    } else {
      where =
        actor.role === 'PLATFORM_ADMIN'
          ? { platformAdminId: actor.id }
          : { schoolId: actor.schoolId! };
    }

    const grants = await prisma.temporaryAccessGrant.findMany({
      where: { ...where, revokedAt: null },
      include: { school: true, grantedBy: true, platformAdmin: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ grants: grants.map(serializeGrant) });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const actor = req.currentUser!;
    const parsed = grantSchema.parse(req.body);

    if (parsed.expiresAt <= new Date()) {
      throw new HttpError(400, "La date d'expiration doit être dans le futur");
    }

    let schoolId: string;
    let platformAdminId: string;

    if (actor.role === 'SCHOOL_ADMIN') {
      if (!actor.schoolId) {
        throw new HttpError(403, "Aucun établissement n'est associé à ce compte");
      }
      if (parsed.schoolId && parsed.schoolId !== actor.schoolId) {
        throw new HttpError(403, 'Accès refusé à cet établissement');
      }
      if (!parsed.email) {
        throw new HttpError(400, "L'e-mail de l'administrateur plateforme est requis");
      }
      const target = await prisma.user.findFirst({
        where: { email: parsed.email, role: 'PLATFORM_ADMIN', isActive: true, deletedAt: null },
      });
      if (!target) {
        throw new HttpError(404, 'Administrateur plateforme introuvable');
      }
      schoolId = actor.schoolId;
      platformAdminId = target.id;
    } else {
      if (!parsed.schoolId) {
        throw new HttpError(400, 'Le paramètre schoolId est requis');
      }
      schoolId = parsed.schoolId;
      platformAdminId = actor.id;
    }

    const school = await prisma.school.findFirst({
      where: { id: schoolId, deletedAt: null },
    });
    if (!school) {
      throw new HttpError(404, 'Établissement introuvable');
    }

    const grant = await prisma.temporaryAccessGrant.create({
      data: {
        schoolId,
        platformAdminId,
        grantedById: actor.id,
        reason: parsed.reason,
        expiresAt: parsed.expiresAt,
      },
    });

    await writeAuditLog({
      req,
      schoolId,
      userId: actor.id,
      action: 'PLATFORM_ACCESS_GRANTED',
      entityType: 'TemporaryAccessGrant',
      entityId: grant.id,
      metadata: { reason: parsed.reason, platformAdminId },
    });

    res.status(201).json({
      grant: { id: grant.id, schoolId: grant.schoolId, expiresAt: grant.expiresAt },
    });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const actor = req.currentUser!;
    const { id } = req.params;
    const grant = await prisma.temporaryAccessGrant.findUnique({ where: { id } });
    if (!grant || grant.revokedAt) {
      throw new HttpError(404, 'Accès introuvable');
    }

    const allowed =
      actor.role === 'PLATFORM_ADMIN'
        ? grant.platformAdminId === actor.id
        : grant.schoolId === actor.schoolId;
    if (!allowed) {
      throw new HttpError(404, 'Accès introuvable');
    }

    await prisma.temporaryAccessGrant.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    await writeAuditLog({
      req,
      schoolId: grant.schoolId,
      userId: actor.id,
      action: 'PLATFORM_ACCESS_REVOKED',
      entityType: 'TemporaryAccessGrant',
      entityId: grant.id,
    });
    res.status(204).end();
  }),
);

export const temporaryAccessRouter = router;
