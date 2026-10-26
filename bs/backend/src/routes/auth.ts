import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { ensureCsrfToken, requireCsrf, rotateCsrfToken } from '../lib/csrf';
import { asyncHandler, HttpError } from '../lib/http';
import {
  generateToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from '../lib/password';
import { publicSchool, publicUser } from '../lib/serializers';
import {
  destroyAllSessions,
  destroyOtherSessions,
  destroySession,
  regenerateSession,
  saveSession,
} from '../lib/session';
import { requireAuth } from '../middleware/auth';
import { writeAuditLog } from '../services/audit';
import { sendPasswordResetEmail } from '../services/mailer';

const router = Router();

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Adresse e-mail invalide');

const passwordSchema = z
  .string()
  .min(12, 'Le mot de passe doit contenir au moins 12 caractères')
  .max(128, 'Le mot de passe ne peut pas dépasser 128 caractères')
  .regex(/[A-Za-z]/, 'Le mot de passe doit contenir au moins une lettre')
  .regex(/[0-9]/, 'Le mot de passe doit contenir au moins un chiffre');

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Mot de passe requis'),
});

const resetRequestSchema = z.object({ email: emailSchema });

const resetConfirmSchema = z.object({
  token: z.string().min(20, 'Jeton invalide'),
  password: passwordSchema,
});

const profileSchema = z.object({
  name: z.string().trim().min(2, 'Nom trop court').max(120, 'Nom trop long'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Mot de passe actuel requis'),
  newPassword: passwordSchema,
});

const rateLimitHandler = (
  _req: unknown,
  res: { status: (code: number) => { json: (body: unknown) => void } },
) => {
  res
    .status(429)
    .json({ error: 'Trop de tentatives. Veuillez réessayer plus tard.' });
};

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.LOGIN_RATE_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler,
});

const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler,
});

async function loadSessionUser(userId: string) {
  return prisma.user.findFirst({
    where: { id: userId, deletedAt: null, isActive: true },
    include: { school: true },
  });
}

router.get(
  '/session',
  asyncHandler(async (req, res) => {
    const csrfToken = ensureCsrfToken(req);
    let user = null;

    if (req.session.userId) {
      const found = await loadSessionUser(req.session.userId);
      if (found) {
        user = found;
      } else {
        delete req.session.userId;
      }
    }

    res.json({
      authenticated: Boolean(user),
      user: user ? publicUser(user) : null,
      school: user?.school ? publicSchool(user.school) : null,
      csrfToken,
    });
  }),
);

router.post(
  '/login',
  loginLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const invalid = new HttpError(401, 'Adresse e-mail ou mot de passe incorrect');
    const found = await prisma.user.findUnique({ where: { email } });

    if (!found || found.deletedAt || !found.isActive) {
      await writeAuditLog({
        req,
        action: 'AUTH_LOGIN_FAILED',
        metadata: { email, reason: 'unknown_or_inactive' },
      });
      throw invalid;
    }

    const now = new Date();
    if (found.lockedUntil && found.lockedUntil > now) {
      await writeAuditLog({
        req,
        schoolId: found.schoolId,
        userId: found.id,
        action: 'AUTH_LOGIN_BLOCKED',
        entityType: 'User',
        entityId: found.id,
      });
      throw new HttpError(
        423,
        'Compte temporairement verrouillé. Veuillez réessayer plus tard.',
      );
    }

    const valid = await verifyPassword(password, found.passwordHash);

    if (!valid) {
      const attempts = found.failedLoginAttempts + 1;
      const lockedUntil =
        attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;

      await prisma.user.update({
        where: { id: found.id },
        data: { failedLoginAttempts: attempts, lockedUntil },
      });

      await writeAuditLog({
        req,
        schoolId: found.schoolId,
        userId: found.id,
        action: 'AUTH_LOGIN_FAILED',
        entityType: 'User',
        entityId: found.id,
        metadata: { attempts },
      });

      if (lockedUntil) {
        throw new HttpError(
          423,
          'Compte temporairement verrouillé après plusieurs échecs. Réessayez dans 15 minutes.',
        );
      }

      throw invalid;
    }

    const user = await prisma.user.update({
      where: { id: found.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: now,
      },
      include: { school: true },
    });

    await regenerateSession(req);
    req.session.userId = user.id;
    const csrfToken = rotateCsrfToken(req);
    await saveSession(req);

    await writeAuditLog({
      req,
      schoolId: user.schoolId,
      userId: user.id,
      action: 'AUTH_LOGIN_SUCCESS',
      entityType: 'User',
      entityId: user.id,
    });

    res.json({
      user: publicUser(user),
      school: user.school ? publicSchool(user.school) : null,
      csrfToken,
    });
  }),
);

router.post(
  '/logout',
  requireCsrf,
  asyncHandler(async (req, res) => {
    const userId = req.session.userId;
    if (userId) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      await writeAuditLog({
        req,
        schoolId: user?.schoolId ?? null,
        userId,
        action: 'AUTH_LOGOUT',
        entityType: 'User',
        entityId: userId,
      });
    }
    await destroySession(req);
    res.status(204).end();
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const csrfToken = ensureCsrfToken(req);
    const user = req.currentUser!;
    res.json({
      user: publicUser(user),
      school: req.currentSchool ? publicSchool(req.currentSchool) : null,
      csrfToken,
    });
  }),
);

router.patch(
  '/profile',
  requireAuth,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const { name } = profileSchema.parse(req.body);
    const user = await prisma.user.update({
      where: { id: req.currentUser!.id },
      data: { name },
    });

    await writeAuditLog({
      req,
      schoolId: user.schoolId,
      userId: user.id,
      action: 'USER_PROFILE_UPDATED',
      entityType: 'User',
      entityId: user.id,
    });

    res.json({ user: publicUser(user) });
  }),
);

router.post(
  '/password',
  requireAuth,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const user = req.currentUser!;

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      throw new HttpError(400, 'Le mot de passe actuel est incorrect');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(newPassword),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    await destroyOtherSessions(user.id, req.sessionID);

    await writeAuditLog({
      req,
      schoolId: user.schoolId,
      userId: user.id,
      action: 'USER_PASSWORD_CHANGED',
      entityType: 'User',
      entityId: user.id,
    });

    res.status(204).end();
  }),
);

router.post(
  '/password-reset/request',
  resetLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const { email } = resetRequestSchema.parse(req.body);
    const user = await prisma.user.findFirst({
      where: { email, deletedAt: null, isActive: true },
    });

    if (user) {
      const token = generateToken();
      const now = new Date();

      await prisma.$transaction([
        prisma.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: now },
        }),
        prisma.passwordResetToken.create({
          data: {
            schoolId: user.schoolId,
            userId: user.id,
            tokenHash: hashToken(token),
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          },
        }),
      ]);

      await sendPasswordResetEmail(user.email, token, user.schoolId);
      await writeAuditLog({
        req,
        schoolId: user.schoolId,
        userId: user.id,
        action: 'AUTH_PASSWORD_RESET_REQUESTED',
        entityType: 'User',
        entityId: user.id,
      });
    }

    res.json({
      message:
        'Si un compte correspond à cette adresse, un lien de réinitialisation a été envoyé.',
    });
  }),
);

router.post(
  '/password-reset/confirm',
  requireCsrf,
  asyncHandler(async (req, res) => {
    const { token, password } = resetConfirmSchema.parse(req.body);
    const tokenHash = hashToken(token);
    const reset = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (
      !reset ||
      reset.usedAt ||
      reset.expiresAt <= new Date() ||
      reset.user.deletedAt ||
      !reset.user.isActive
    ) {
      throw new HttpError(400, 'Lien de réinitialisation invalide ou expiré');
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: reset.userId },
        data: {
          passwordHash: await hashPassword(password),
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
      prisma.passwordResetToken.update({
        where: { id: reset.id },
        data: { usedAt: new Date() },
      }),
      prisma.passwordResetToken.updateMany({
        where: { userId: reset.userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);

    await destroyAllSessions(reset.userId);

    await writeAuditLog({
      req,
      schoolId: reset.schoolId,
      userId: reset.userId,
      action: 'AUTH_PASSWORD_RESET_COMPLETED',
      entityType: 'User',
      entityId: reset.userId,
    });

    res.status(204).end();
  }),
);

export const authRouter = router;
