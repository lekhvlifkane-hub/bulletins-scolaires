import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../db/prisma';

type AuditInput = {
  req?: Request;
  schoolId?: string | null;
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
};

export async function writeAuditLog(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        schoolId: input.schoolId ?? null,
        userId: input.userId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata,
        ip: input.req?.ip,
        userAgent: input.req?.get('user-agent'),
      },
    });
  } catch (error) {
    console.error("Impossible d'enregistrer le journal d'audit", error);
  }
}
