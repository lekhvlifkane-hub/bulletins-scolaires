import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { asyncHandler, HttpError } from '../lib/http';
import { requireCsrf } from '../lib/csrf';
import { requireAuth, requireRole, requireSchoolId } from '../middleware/auth';
import { resumeAbsences } from '../services/attendance';
import { writeAuditLog } from '../services/audit';
import type { SnapshotBulletin } from '../services/bulletins/types';

const router = Router();

const attendanceSchema = z.object({
  enrollmentId: z.string().min(1),
  semesterId: z.string().min(1),
  kind: z.enum(['ABSENCE', 'RETARD']),
  date: z.coerce.date(),
  justified: z.boolean().default(false),
  durationMinutes: z.number().int().positive().nullable().optional(),
  reason: z.string().trim().max(300).nullable().optional(),
});

const attendanceUpdateSchema = attendanceSchema
  .omit({ enrollmentId: true, semesterId: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Aucun champ à modifier' });

const appreciationSchema = z.object({
  enrollmentId: z.string().min(1),
  semesterId: z.string().min(1),
  subjectId: z.string().min(1),
  content: z.string().trim().max(500),
});

const decisionSchema = z.object({
  enrollmentId: z.string().min(1),
  academicYearId: z.string().min(1),
  content: z.string().trim().min(1).max(500),
});

async function synchroniserAppreciationBrouillons(
  tx: Prisma.TransactionClient,
  schoolId: string,
  enrollmentId: string,
  semesterId: string,
  subjectId: string,
  content: string | null,
) {
  const cards = await tx.reportCard.findMany({
    where: {
      schoolId,
      enrollmentId,
      semesterId,
      statut: { not: 'PUBLIE' },
      deletedAt: null,
    },
  });
  for (const card of cards) {
    const snapshot = card.snapshot as unknown as SnapshotBulletin;
    const matiere = snapshot.matieres.find((row) => row.subjectId === subjectId);
    if (!matiere) continue;
    matiere.appreciation = content;
    await tx.reportCard.update({
      where: { id: card.id },
      data: { snapshot: snapshot as unknown as Prisma.InputJsonValue },
    });
  }
}

router.use(requireAuth, requireRole('SCHOOL_ADMIN', 'SURVEILLANT_GENERAL', 'ASSISTANT'));

/**
 * @openapi
 * /api/school-life/attendance:
 *   get:
 *     summary: Lire les événements de présence d'un élève pour un semestre
 *     tags: [Vie scolaire]
 *     parameters:
 *       - in: query
 *         name: enrollmentId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: semesterId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Événements et totaux d'absences/retards }
 *       404: { description: Inscription ou semestre hors de l'établissement }
 *   post:
 *     summary: Enregistrer une absence ou un retard
 *     tags: [Vie scolaire]
 *     description: Session et jeton CSRF requis ; date comprise dans le semestre.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [enrollmentId, semesterId, kind, date]
 *             properties:
 *               enrollmentId: { type: string }
 *               semesterId: { type: string }
 *               kind: { type: string, enum: [ABSENCE, RETARD] }
 *               date: { type: string, format: date }
 *               justified: { type: boolean }
 *               durationMinutes: { type: integer, nullable: true }
 *               reason: { type: string, nullable: true }
 *     responses:
 *       201: { description: Événement enregistré et journalisé }
 *       400: { description: Date, semestre ou données invalides }
 * /api/school-life/attendance/{id}:
 *   patch:
 *     summary: Corriger un événement de présence
 *     tags: [Vie scolaire]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Événement corrigé ; les valeurs avant/après sont auditées }
 *       404: { description: Événement introuvable }
 *   delete:
 *     summary: Supprimer logiquement un événement de présence
 *     tags: [Vie scolaire]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Événement archivé dans l'historique }
 * /api/school-life/appreciations:
 *   get:
 *     summary: Lire les appréciations disciplinaires d'un élève
 *     tags: [Vie scolaire]
 *     parameters:
 *       - in: query
 *         name: enrollmentId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: semesterId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Appréciations par discipline }
 *   put:
 *     summary: Créer ou modifier une appréciation disciplinaire
 *     tags: [Vie scolaire]
 *     description: Met à jour aussi les snapshots des bulletins brouillon ; les bulletins publiés restent figés.
 *     responses:
 *       200: { description: Appréciation enregistrée et journalisée }
 * /api/school-life/council-decisions:
 *   get:
 *     summary: Lire les décisions courantes pour une année scolaire
 *     tags: [Vie scolaire]
 *     parameters:
 *       - in: query
 *         name: academicYearId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Décisions avec leur statut brouillon/validée }
 *   post:
 *     summary: Créer ou modifier un brouillon de décision du conseil
 *     tags: [Vie scolaire]
 *     responses:
 *       201: { description: Brouillon créé ; aucune publication officielle avant validation }
 *       200: { description: Brouillon mis à jour }
 * /api/school-life/council-decisions/{id}/validate:
 *   post:
 *     summary: Valider une décision du conseil
 *     tags: [Vie scolaire]
 *     description: Réservé à l'administrateur d'établissement ; synchronise les bilans annuels non publiés.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Décision validée et datée }
 *       404: { description: Décision introuvable }
 * /api/school-life/archives:
 *   get:
 *     summary: Consulter l'archive complète d'une année scolaire clôturée
 *     tags: [Vie scolaire]
 *     parameters:
 *       - in: query
 *         name: academicYearId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Versions des bulletins, bilans et données de vie scolaire }
 *       409: { description: Année non clôturée }
 * /api/school-life/history:
 *   get:
 *     summary: Lire le journal des modifications d'un élément
 *     tags: [Vie scolaire]
 *     parameters:
 *       - in: query
 *         name: entityType
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: entityId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Historique récent des actions et valeurs auditées }
 */
function dateOnly(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

async function assertEnrollmentSemester(schoolId: string, enrollmentId: string, semesterId: string) {
  const [enrollment, semester] = await Promise.all([
    prisma.enrollment.findFirst({
      where: { id: enrollmentId, schoolId, deletedAt: null },
      include: { classroom: true },
    }),
    prisma.semester.findFirst({ where: { id: semesterId, academicYear: { schoolId } } }),
  ]);
  if (!enrollment || !semester) throw new HttpError(404, 'Inscription ou semestre introuvable');
  if (
    enrollment.classroom.schoolId !== schoolId ||
    enrollment.classroom.academicYearId !== semester.academicYearId
  ) {
    throw new HttpError(400, "Le semestre ne correspond pas à l'année de l'inscription");
  }
  return { enrollment, semester };
}

async function validerDateDansSemestre(date: Date, semesterId: string) {
  const jour = dateOnly(date);
  const semester = await prisma.semester.findUnique({ where: { id: semesterId } });
  if (!semester || jour < dateOnly(semester.startsAt) || jour > dateOnly(semester.endsAt)) {
    throw new HttpError(400, 'La date doit être comprise dans les dates du semestre');
  }
  return jour;
}

router.get('/attendance', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const semesterId = typeof req.query.semesterId === 'string' ? req.query.semesterId : '';
  const enrollmentId = typeof req.query.enrollmentId === 'string' ? req.query.enrollmentId : '';
  if (!semesterId || !enrollmentId) throw new HttpError(400, 'Paramètres semesterId et enrollmentId requis');
  await assertEnrollmentSemester(schoolId, enrollmentId, semesterId);
  const records = await prisma.attendanceRecord.findMany({
    where: { schoolId, enrollmentId, semesterId, deletedAt: null },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
  res.json({ records, resume: await resumeAbsences(schoolId, enrollmentId, [semesterId]) });
}));

router.post('/attendance', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const data = attendanceSchema.parse(req.body);
  await assertEnrollmentSemester(schoolId, data.enrollmentId, data.semesterId);
  const date = await validerDateDansSemestre(data.date, data.semesterId);
  if (data.kind === 'ABSENCE' && data.durationMinutes !== undefined && data.durationMinutes !== null) {
    throw new HttpError(400, 'La durée en minutes est réservée aux retards');
  }
  const record = await prisma.attendanceRecord.create({
    data: {
      ...data,
      date,
      schoolId,
      recordedById: req.currentUser!.id,
      ...(data.durationMinutes !== undefined ? { durationMinutes: data.durationMinutes } : {}),
    },
  });
  await writeAuditLog({
    req,
    schoolId,
    userId: req.currentUser!.id,
    action: 'ATTENDANCE_CREATED',
    entityType: 'AttendanceRecord',
    entityId: record.id,
    metadata: { after: record as unknown as Prisma.InputJsonValue },
  });
  res.status(201).json({ record });
}));

router.patch('/attendance/:id', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const data = attendanceUpdateSchema.parse(req.body);
  const before = await prisma.attendanceRecord.findFirst({
    where: { id: req.params.id, schoolId, deletedAt: null },
  });
  if (!before) throw new HttpError(404, 'Événement de présence introuvable');
  const kind = data.kind ?? before.kind;
  if (kind === 'ABSENCE' && data.durationMinutes != null) {
    throw new HttpError(400, 'La durée en minutes est réservée aux retards');
  }
  const date = data.date ? await validerDateDansSemestre(data.date, before.semesterId) : undefined;
  const record = await prisma.attendanceRecord.update({
    where: { id: before.id },
    data: { ...data, ...(kind === 'ABSENCE' ? { durationMinutes: null } : {}), ...(date ? { date } : {}) },
  });
  await writeAuditLog({
    req,
    schoolId,
    userId: req.currentUser!.id,
    action: 'ATTENDANCE_UPDATED',
    entityType: 'AttendanceRecord',
    entityId: record.id,
    metadata: {
      before: before as unknown as Prisma.InputJsonValue,
      after: record as unknown as Prisma.InputJsonValue,
    },
  });
  res.json({ record });
}));

router.delete('/attendance/:id', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const before = await prisma.attendanceRecord.findFirst({
    where: { id: req.params.id, schoolId, deletedAt: null },
  });
  if (!before) throw new HttpError(404, 'Événement de présence introuvable');
  const record = await prisma.attendanceRecord.update({
    where: { id: before.id },
    data: { deletedAt: new Date() },
  });
  await writeAuditLog({
    req,
    schoolId,
    userId: req.currentUser!.id,
    action: 'ATTENDANCE_DELETED',
    entityType: 'AttendanceRecord',
    entityId: record.id,
    metadata: { before: before as unknown as Prisma.InputJsonValue },
  });
  res.json({ record });
}));

router.put('/appreciations', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const data = appreciationSchema.parse(req.body);
  const { enrollment } = await assertEnrollmentSemester(schoolId, data.enrollmentId, data.semesterId);
  const subject = await prisma.classroomSubject.findFirst({
    where: {
      schoolId,
      classroomId: enrollment.classroomId,
      subjectId: data.subjectId,
    },
  });
  if (!subject) throw new HttpError(404, 'Discipline non affectée à la classe');

  const before = await prisma.appreciation.findUnique({
    where: {
      enrollmentId_semesterId_subjectId: {
        enrollmentId: data.enrollmentId,
        semesterId: data.semesterId,
        subjectId: data.subjectId,
      },
    },
  });
  if (before && before.schoolId !== schoolId) throw new HttpError(404, 'Appréciation introuvable');
  if (!data.content) {
    if (!before || before.deletedAt) {
      await prisma.$transaction((tx) =>
        synchroniserAppreciationBrouillons(
          tx, schoolId, data.enrollmentId, data.semesterId, data.subjectId, null,
        )
      );
      res.json({ appreciation: null });
      return;
    }
    const removed = await prisma.$transaction(async (tx) => {
      const deleted = await tx.appreciation.update({
        where: { id: before.id },
        data: { deletedAt: new Date(), updatedById: req.currentUser!.id },
      });
      await synchroniserAppreciationBrouillons(
        tx, schoolId, data.enrollmentId, data.semesterId, data.subjectId, null,
      );
      return deleted;
    });
    await writeAuditLog({
      req,
      schoolId,
      userId: req.currentUser!.id,
      action: 'APPRECIATION_DELETED',
      entityType: 'Appreciation',
      entityId: removed.id,
      metadata: { before: before as unknown as Prisma.InputJsonValue },
    });
    res.json({ appreciation: null });
    return;
  }
  const appreciation = await prisma.$transaction(async (tx) => {
    const updated = await tx.appreciation.upsert({
      where: {
        enrollmentId_semesterId_subjectId: {
          enrollmentId: data.enrollmentId,
          semesterId: data.semesterId,
          subjectId: data.subjectId,
        },
      },
      create: {
        ...data,
        schoolId,
        createdById: req.currentUser!.id,
        updatedById: req.currentUser!.id,
      },
      update: {
        content: data.content,
        deletedAt: null,
        updatedById: req.currentUser!.id,
      },
    });
    await synchroniserAppreciationBrouillons(
      tx, schoolId, data.enrollmentId, data.semesterId, data.subjectId, data.content,
    );
    return updated;
  });
  await writeAuditLog({
    req,
    schoolId,
    userId: req.currentUser!.id,
    action: before ? 'APPRECIATION_UPDATED' : 'APPRECIATION_CREATED',
    entityType: 'Appreciation',
    entityId: appreciation.id,
    metadata: {
      before: before ? (before as unknown as Prisma.InputJsonValue) : null,
      after: appreciation as unknown as Prisma.InputJsonValue,
    },
  });
  res.json({ appreciation });
}));

router.get('/appreciations', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const enrollmentId = typeof req.query.enrollmentId === 'string' ? req.query.enrollmentId : '';
  const semesterId = typeof req.query.semesterId === 'string' ? req.query.semesterId : '';
  if (!enrollmentId || !semesterId) {
    throw new HttpError(400, 'Paramètres enrollmentId et semesterId requis');
  }
  await assertEnrollmentSemester(schoolId, enrollmentId, semesterId);
  const appreciations = await prisma.appreciation.findMany({
    where: { schoolId, enrollmentId, semesterId, deletedAt: null },
    include: { subject: true },
    orderBy: { subject: { name: 'asc' } },
  });
  res.json({ appreciations });
}));

router.delete('/appreciations/:id', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const before = await prisma.appreciation.findFirst({
    where: { id: req.params.id, schoolId, deletedAt: null },
  });
  if (!before) throw new HttpError(404, 'Appréciation introuvable');
  const appreciation = await prisma.$transaction(async (tx) => {
    const updated = await tx.appreciation.update({
      where: { id: before.id },
      data: { deletedAt: new Date(), updatedById: req.currentUser!.id },
    });
    await synchroniserAppreciationBrouillons(
      tx, schoolId, before.enrollmentId, before.semesterId, before.subjectId, null,
    );
    return updated;
  });
  await writeAuditLog({
    req,
    schoolId,
    userId: req.currentUser!.id,
    action: 'APPRECIATION_DELETED',
    entityType: 'Appreciation',
    entityId: appreciation.id,
    metadata: { before: before as unknown as Prisma.InputJsonValue },
  });
  res.json({ appreciation });
}));

router.get('/council-decisions', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const academicYearId = typeof req.query.academicYearId === 'string' ? req.query.academicYearId : '';
  if (!academicYearId) throw new HttpError(400, 'Paramètre academicYearId requis');
  const year = await prisma.academicYear.findFirst({ where: { id: academicYearId, schoolId, deletedAt: null } });
  if (!year) throw new HttpError(404, 'Année scolaire introuvable');
  const decisions = await prisma.councilDecision.findMany({
    where: { schoolId, academicYearId, isCurrent: true, deletedAt: null },
    include: { enrollment: { include: { student: true, classroom: true } } },
    orderBy: [{ enrollment: { student: { lastName: 'asc' } } }],
  });
  res.json({ decisions });
}));

router.post('/council-decisions', requireCsrf, requireRole('SCHOOL_ADMIN', 'SURVEILLANT_GENERAL'), asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const data = decisionSchema.parse(req.body);
  const enrollment = await prisma.enrollment.findFirst({
    where: { id: data.enrollmentId, schoolId, deletedAt: null },
    include: { classroom: true },
  });
  const year = await prisma.academicYear.findFirst({
    where: { id: data.academicYearId, schoolId, deletedAt: null },
  });
  if (!enrollment || !year) throw new HttpError(404, 'Inscription ou année scolaire introuvable');
  if (enrollment.classroom.academicYearId !== year.id) {
    throw new HttpError(400, "L'inscription ne correspond pas à l'année scolaire");
  }
  const existing = await prisma.councilDecision.findFirst({
    where: { schoolId, enrollmentId: enrollment.id, academicYearId: year.id, isCurrent: true, deletedAt: null },
    orderBy: { version: 'desc' },
  });
  if (existing?.status === 'BROUILLON') {
    const updated = await prisma.councilDecision.update({
      where: { id: existing.id },
      data: { content: data.content },
    });
    await writeAuditLog({
      req, schoolId, userId: req.currentUser!.id, action: 'COUNCIL_DECISION_UPDATED',
      entityType: 'CouncilDecision', entityId: updated.id,
      metadata: { before: { content: existing.content }, after: { content: updated.content } },
    });
    res.json({ decision: updated });
    return;
  }
  const decision = await prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.councilDecision.update({ where: { id: existing.id }, data: { isCurrent: false } });
    }
    return tx.councilDecision.create({
      data: {
        ...data,
        schoolId,
        version: (existing?.version ?? 0) + 1,
        previousDecisionId: existing?.id,
      },
    });
  });
  await writeAuditLog({
    req, schoolId, userId: req.currentUser!.id, action: 'COUNCIL_DECISION_CREATED',
    entityType: 'CouncilDecision', entityId: decision.id,
    metadata: { version: decision.version, status: decision.status, content: decision.content },
  });
  res.status(201).json({ decision });
}));

router.post('/council-decisions/:id/validate', requireCsrf, requireRole('SCHOOL_ADMIN'), asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const decision = await prisma.councilDecision.findFirst({
    where: { id: req.params.id, schoolId, isCurrent: true, deletedAt: null },
  });
  if (!decision) throw new HttpError(404, 'Décision du conseil introuvable');
  if (decision.status === 'VALIDEE') {
    res.json({ decision, dejaValidee: true });
    return;
  }
  const validated = await prisma.$transaction(async (tx) => {
    const updated = await tx.councilDecision.update({
      where: { id: decision.id },
      data: { status: 'VALIDEE', validatedAt: new Date(), validatedById: req.currentUser!.id },
    });
    const summaries = await tx.annualSummary.findMany({
      where: {
        schoolId,
        enrollmentId: decision.enrollmentId,
        academicYearId: decision.academicYearId,
        estCourant: true,
        statut: { not: 'PUBLIE' },
        deletedAt: null,
      },
    });
    for (const summary of summaries) {
      const snapshot = summary.snapshot as Record<string, unknown>;
      await tx.annualSummary.update({
        where: { id: summary.id },
        data: {
          decisionConseil: updated.content,
          snapshot: {
            ...snapshot,
            decisionConseil: updated.content,
            decisionConseilValideeLe: updated.validatedAt?.toISOString() ?? null,
          } as Prisma.InputJsonValue,
        },
      });
    }
    return updated;
  });
  await writeAuditLog({
    req, schoolId, userId: req.currentUser!.id, action: 'COUNCIL_DECISION_VALIDATED',
    entityType: 'CouncilDecision', entityId: validated.id,
    metadata: { content: validated.content, validatedAt: validated.validatedAt?.toISOString() },
  });
  res.json({ decision: validated, dejaValidee: false });
}));

router.get('/archives', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const academicYearId = typeof req.query.academicYearId === 'string' ? req.query.academicYearId : '';
  if (!academicYearId) throw new HttpError(400, 'Paramètre academicYearId requis');
  const year = await prisma.academicYear.findFirst({
    where: { id: academicYearId, schoolId, deletedAt: null, status: 'CLOSED' },
  });
  if (!year) {
    const exists = await prisma.academicYear.findFirst({
      where: { id: academicYearId, schoolId, deletedAt: null },
    });
    if (!exists) throw new HttpError(404, 'Année scolaire introuvable');
    throw new HttpError(409, "L'année scolaire n'est pas clôturée et ne figure pas dans les archives");
  }
  const [reportCards, annualSummaries, attendanceRecords, appreciations, councilDecisions] = await Promise.all([
    prisma.reportCard.findMany({
      where: { schoolId, academicYearId, deletedAt: null },
      include: { enrollment: { include: { student: true, classroom: true } }, semester: true },
      orderBy: [{ academicYearId: 'desc' }, { enrollment: { student: { lastName: 'asc' } } }, { version: 'desc' }],
    }),
    prisma.annualSummary.findMany({
      where: { schoolId, academicYearId, deletedAt: null },
      include: { enrollment: { include: { student: true, classroom: true } } },
      orderBy: [{ academicYearId: 'desc' }, { enrollment: { student: { lastName: 'asc' } } }, { version: 'desc' }],
    }),
    prisma.attendanceRecord.findMany({
      where: { schoolId, semester: { academicYearId } },
      include: { enrollment: { include: { student: true } }, semester: true },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.appreciation.findMany({
      where: { schoolId, semester: { academicYearId } },
      include: { enrollment: { include: { student: true } }, subject: true, semester: true },
      orderBy: [{ semester: { number: 'asc' } }, { enrollment: { student: { lastName: 'asc' } } }],
    }),
    prisma.councilDecision.findMany({
      where: { schoolId, academicYearId },
      include: {
        enrollment: { include: { student: true } },
        validatedBy: { select: { id: true, name: true } },
      },
      orderBy: [{ enrollment: { student: { lastName: 'asc' } } }, { version: 'desc' }],
    }),
  ]);
  res.json({
    annee: year,
    bulletins: reportCards,
    bilansAnnuels: annualSummaries,
    presences: attendanceRecords,
    appreciations,
    decisionsConseil: councilDecisions,
  });
}));

router.get('/history', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const entityType = typeof req.query.entityType === 'string' ? req.query.entityType : '';
  const entityId = typeof req.query.entityId === 'string' ? req.query.entityId : '';
  if (!entityType || !entityId) throw new HttpError(400, 'Paramètres entityType et entityId requis');
  const history = await prisma.auditLog.findMany({
    where: { schoolId, entityType, entityId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ history });
}));

export const schoolLifeRouter = router;
