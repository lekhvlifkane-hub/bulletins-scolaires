import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { tenantUsers } from '../db/tenant';
import { asyncHandler, HttpError } from '../lib/http';
import { generateTemporaryPassword, hashPassword } from '../lib/password';
import { destroyAllSessions } from '../lib/session';
import { publicUser } from '../lib/serializers';
import { requireAuth, requireRole } from '../middleware/auth';
import { assertPlatformAccess, requireSchoolScope } from '../middleware/school-scope';
import { writeAuditLog } from '../services/audit';
import { requireCsrf } from '../lib/csrf';

const router = Router();
const MAX_USERS_PER_SCHOOL = 3;

const createUserSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(['SCHOOL_ADMIN', 'SURVEILLANT_GENERAL', 'ASSISTANT']),
  password: z.string().min(12).optional(),
});

const updateUserSchema = z.object({
  name: z.string().trim().min(2).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  role: z.enum(['SCHOOL_ADMIN', 'SURVEILLANT_GENERAL', 'ASSISTANT']).optional(),
  isActive: z.boolean().optional(),
});

router.use(requireAuth);

router.get(
  '/',
  requireSchoolScope,
  requireRole('PLATFORM_ADMIN', 'SCHOOL_ADMIN'),
  asyncHandler(async (req, res) => {
    if (req.currentUser!.role === 'PLATFORM_ADMIN') {
      if (!req.schoolScopeId) {
        throw new HttpError(400, 'schoolId requis');
      }
      const [users, school] = await Promise.all([
        prisma.user.findMany({
          where: { schoolId: req.schoolScopeId, deletedAt: null },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.school.findUnique({
          where: { id: req.schoolScopeId },
          select: { accountMode: true },
        }),
      ]);
      const accountMode = school?.accountMode ?? 'EQUIPE';
      res.json({
        users: users.map(publicUser),
        accountMode,
        maxUsers: accountMode === 'SOLO' ? 1 : MAX_USERS_PER_SCHOOL,
      });
      return;
    }

    const schoolId = req.currentUser!.schoolId!;
    const [users, school] = await Promise.all([
      tenantUsers(schoolId).list(),
      prisma.school.findUnique({ where: { id: schoolId }, select: { accountMode: true } }),
    ]);
    const accountMode = school?.accountMode ?? 'EQUIPE';
    res.json({
      users: users.map(publicUser),
      accountMode,
      maxUsers: accountMode === 'SOLO' ? 1 : MAX_USERS_PER_SCHOOL,
    });
  }),
);

router.post(
  '/',
  requireSchoolScope,
  requireRole('PLATFORM_ADMIN', 'SCHOOL_ADMIN'),
  requireCsrf,
  asyncHandler(async (req, res) => {
    const actor = req.currentUser!;
    const { name, email, role, password } = createUserSchema.parse(req.body);

    if (actor.role === 'SCHOOL_ADMIN' && role === 'SCHOOL_ADMIN') {
      throw new HttpError(403, 'Impossible de créer un autre administrateur');
    }

    let schoolId = actor.schoolId;
    if (actor.role === 'PLATFORM_ADMIN') {
      schoolId = req.schoolScopeId ?? null;
      if ((role as string) === 'PLATFORM_ADMIN') {
        throw new HttpError(403, "Impossible de créer un compte plateforme");
      }
    }

    if (!schoolId) {
      throw new HttpError(400, "L'établissement est requis");
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new HttpError(409, 'Un compte existe déjà avec cet e-mail');
    }

    const finalPassword = password ?? generateTemporaryPassword();
    const passwordHash = await hashPassword(finalPassword);
    const user = await prisma.$transaction(async (transaction) => {
      const school = await transaction.$queryRaw<Array<{ id: string; accountMode: 'SOLO' | 'EQUIPE' }>>`
        SELECT "id", "accountMode" FROM "School" WHERE "id" = ${schoolId} FOR UPDATE
      `;
      if (school.length === 0) throw new HttpError(404, "Établissement introuvable");

      const limite = school[0]!.accountMode === 'SOLO' ? 1 : MAX_USERS_PER_SCHOOL;
      const accountCount = await transaction.user.count({
        where: { schoolId, deletedAt: null },
      });
      if (accountCount >= limite) {
        const message = limite === 1
          ? "Cet établissement fonctionne avec un compte unique : aucun autre utilisateur ne peut être créé"
          : `La limite de ${limite} comptes par établissement est atteinte`;
        throw new HttpError(409, message);
      }

      return transaction.user.create({
        data: {
          schoolId,
          name,
          email,
          role,
          passwordHash,
          isActive: true,
        },
      });
    });

    await writeAuditLog({
      req,
      schoolId,
      userId: actor.id,
      action: 'USER_CREATED',
      entityType: 'User',
      entityId: user.id,
      metadata: { email: user.email, role: user.role },
    });

    res.status(201).json({
      user: publicUser(user),
      temporaryPassword: password ? undefined : finalPassword,
    });
  }),
);

router.post(
  '/:id/reset-password',
  requireRole('PLATFORM_ADMIN'),
  requireCsrf,
  asyncHandler(async (req, res) => {
    const actor = req.currentUser!;
    const target = await prisma.user.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!target || !target.schoolId) {
      throw new HttpError(404, 'Utilisateur introuvable');
    }
    if (target.role === 'PLATFORM_ADMIN') {
      throw new HttpError(403, 'Impossible de réinitialiser un compte plateforme');
    }
    await assertPlatformAccess(actor.id, target.schoolId);

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    await prisma.user.update({
      where: { id: target.id },
      data: {
        passwordHash,
        failedLoginAttempts: 0,
        lockedUntil: null,
        isActive: true,
      },
    });
    await destroyAllSessions(target.id);
    await writeAuditLog({
      req,
      schoolId: target.schoolId,
      userId: actor.id,
      action: 'USER_PASSWORD_RESET',
      entityType: 'User',
      entityId: target.id,
      metadata: { email: target.email },
    });
    res.json({ temporaryPassword });
  }),
);

router.patch(
  '/:id',
  requireRole('PLATFORM_ADMIN', 'SCHOOL_ADMIN'),
  requireCsrf,
  asyncHandler(async (req, res) => {
    const actor = req.currentUser!;
    const { id } = req.params;
    const data = updateUserSchema.parse(req.body);

    if (actor.role !== 'PLATFORM_ADMIN') {
      const schoolId = actor.schoolId!;
      const target = await tenantUsers(schoolId).findById(id);
      if (!target) {
        throw new HttpError(404, 'Utilisateur introuvable');
      }
      if (target.role === 'SCHOOL_ADMIN' && target.id !== actor.id) {
        throw new HttpError(403, "Impossible de modifier un autre administrateur");
      }
      if (Object.prototype.hasOwnProperty.call(data, 'role')) {
        if (target.role === 'SCHOOL_ADMIN' && target.id !== actor.id) {
          throw new HttpError(403, "Impossible de modifier le rôle d'un administrateur");
        }
      }
      const updated = await prisma.user.update({ where: { id }, data });
      await writeAuditLog({
        req,
        schoolId,
        userId: actor.id,
        action: 'USER_UPDATED',
        entityType: 'User',
        entityId: updated.id,
      });
      res.json({ user: publicUser(updated) });
      return;
    }

    const target = await prisma.user.findFirst({
      where: { id, deletedAt: null },
    });
    if (!target || !target.schoolId) {
      throw new HttpError(404, 'Utilisateur introuvable');
    }
    await assertPlatformAccess(actor.id, target.schoolId);
    if (data.role && target.role === 'PLATFORM_ADMIN') {
      throw new HttpError(403, "Impossible de modifier un compte plateforme");
    }
    const schoolId = target.schoolId;
    const updated = await prisma.user.update({ where: { id }, data });
    await writeAuditLog({
      req,
      schoolId,
      userId: actor.id,
      action: 'USER_UPDATED',
      entityType: 'User',
      entityId: updated.id,
    });
    res.json({ user: publicUser(updated) });
  }),
);

router.delete(
  '/:id',
  requireRole('PLATFORM_ADMIN', 'SCHOOL_ADMIN'),
  requireCsrf,
  asyncHandler(async (req, res) => {
    const actor = req.currentUser!;
    const { id } = req.params;

    if (actor.id === id) {
      throw new HttpError(400, 'Impossible de supprimer votre propre compte');
    }

    if (actor.role !== 'PLATFORM_ADMIN') {
      const schoolId = actor.schoolId!;
      const target = await tenantUsers(schoolId).findById(id);
      if (!target) {
        throw new HttpError(404, 'Utilisateur introuvable');
      }
      if (target.role === 'SCHOOL_ADMIN') {
        throw new HttpError(403, "Impossible de supprimer un autre administrateur");
      }
      await tenantUsers(schoolId).softDelete(id);
      await writeAuditLog({
        req,
        schoolId,
        userId: actor.id,
        action: 'USER_DELETED',
        entityType: 'User',
        entityId: id,
      });
      res.status(204).end();
      return;
    }

    const target = await prisma.user.findFirst({
      where: { id, deletedAt: null },
    });
    if (!target || !target.schoolId) {
      throw new HttpError(404, 'Utilisateur introuvable');
    }
    await assertPlatformAccess(actor.id, target.schoolId);
    if (target.role === 'PLATFORM_ADMIN') {
      throw new HttpError(403, "Impossible de supprimer un compte plateforme");
    }
    const schoolId = target.schoolId;
    await prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await writeAuditLog({
      req,
      schoolId,
      userId: actor.id,
      action: 'USER_DELETED',
      entityType: 'User',
      entityId: id,
    });
    res.status(204).end();
  }),
);

export const usersRouter = router;
