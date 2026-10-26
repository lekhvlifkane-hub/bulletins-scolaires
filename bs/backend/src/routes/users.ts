import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { tenantUsers } from '../db/tenant';
import { asyncHandler, HttpError } from '../lib/http';
import { generateTemporaryPassword, hashPassword } from '../lib/password';
import { publicUser } from '../lib/serializers';
import { requireAuth, requireRole } from '../middleware/auth';
import { assertPlatformAccess, requireSchoolScope } from '../middleware/school-scope';
import { writeAuditLog } from '../services/audit';
import { sendInvitationEmail } from '../services/mailer';
import { requireCsrf } from '../lib/csrf';

const router = Router();

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
      const users = await prisma.user.findMany({
        where: { schoolId: req.schoolScopeId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
      res.json({ users: users.map(publicUser) });
      return;
    }

    const schoolId = req.currentUser!.schoolId!;
    const users = await tenantUsers(schoolId).list();
    res.json({ users: users.map(publicUser) });
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
    const user = await prisma.user.create({
      data: {
        schoolId,
        name,
        email,
        role,
        passwordHash: await hashPassword(finalPassword),
        isActive: true,
      },
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

    if (!password) {
      // Le mot de passe temporaire part directement à l'intéressé : l'établissement
      // n'a pas à le transmettre à la main à chaque ouverture de compte.
      const ecole = await prisma.school.findUnique({
        where: { id: schoolId },
        select: { name: true },
      });
      await sendInvitationEmail({
        to: user.email,
        temporaryPassword: finalPassword,
        etablissement: ecole?.name ?? 'votre établissement',
        schoolId,
      });
    }

    res.status(201).json({
      user: publicUser(user),
      temporaryPassword: password ? undefined : finalPassword,
    });
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
