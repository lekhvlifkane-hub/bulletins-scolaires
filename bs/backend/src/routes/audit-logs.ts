import { Router } from 'express';
import { prisma } from '../db/prisma';
import { asyncHandler } from '../lib/http';
import { requireAuth, requireRole } from '../middleware/auth';
import { requireSchoolScope } from '../middleware/school-scope';

const router = Router();

router.use(
  requireAuth,
  requireRole('PLATFORM_ADMIN', 'SCHOOL_ADMIN'),
  requireSchoolScope,
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const schoolId = req.schoolScopeId!;
    const logs = await prisma.auditLog.findMany({
      where: { schoolId },
      include: { user: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({
      logs: logs.map((log) => ({
        id: log.id,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        metadata: log.metadata,
        ip: log.ip,
        userAgent: log.userAgent,
        createdAt: log.createdAt,
        user: log.user ? { id: log.user.id, name: log.user.name, email: log.user.email } : null,
      })),
    });
  }),
);

export const auditLogsRouter = router;
