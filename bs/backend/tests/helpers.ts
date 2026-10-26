import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/db/prisma';
import { hashPassword } from '../src/lib/password';
import { Role } from '@prisma/client';

/**
 * Vide la base de test dans l'ordre inverse des dépendances (cles étrangères).
 * Les tables des phases 1 à 6 sont toutes couvertes : sans cela, la suppression
 * d'un élève ou d'un établissement échoue dès qu'il existe des bulletins ou des notes.
 */
export async function cleanTestDb() {
  await prisma.$transaction([
    prisma.emailOutbox.deleteMany(),
    prisma.councilDecision.deleteMany(),
    prisma.appreciation.deleteMany(),
    prisma.attendanceRecord.deleteMany(),
    prisma.annualSummary.deleteMany(),
    prisma.reportCard.deleteMany(),
    prisma.grade.deleteMany(),
    prisma.assessment.deleteMany(),
    prisma.assessmentType.deleteMany(),
    prisma.classroomSubject.deleteMany(),
    prisma.enrollment.deleteMany(),
    prisma.subject.deleteMany(),
    prisma.student.deleteMany(),
    prisma.classroom.deleteMany(),
    prisma.series.deleteMany(),
    prisma.level.deleteMany(),
    prisma.semester.deleteMany(),
    prisma.academicYear.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.temporaryAccessGrant.deleteMany(),
    prisma.passwordResetToken.deleteMany(),
    prisma.user.deleteMany(),
    prisma.school.deleteMany(),
  ]);
}

export async function createSchool(name = `École ${randomUUID().slice(0, 6)}`) {
  return prisma.school.create({
    data: {
      name,
      isActive: true,
    },
  });
}

export async function createUser(options: {
  email?: string;
  password?: string;
  role: Role;
  schoolId?: string | null;
  name?: string;
  isActive?: boolean;
}) {
  const email = options.email ?? `user-${randomUUID().slice(0, 8)}@test.sn`;
  const password = options.password ?? 'MotDePasse123456';
  return prisma.user.create({
    data: {
      name: options.name ?? 'Test User',
      email,
      passwordHash: await hashPassword(password),
      role: options.role,
      schoolId: options.schoolId ?? null,
      isActive: options.isActive ?? true,
      failedLoginAttempts: 0,
    },
  });
}

export function authHeaders(csrfToken?: string) {
  const headers: Record<string, string> = {};
  if (csrfToken) {
    headers['x-csrf-token'] = csrfToken;
  }
  return headers;
}
