import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { asyncHandler, HttpError } from '../lib/http';
import { requireCsrf } from '../lib/csrf';
import { requireAuth, requireRole } from '../middleware/auth';
import { requireSchoolId } from '../middleware/auth';
import { writeAuditLog } from '../services/audit';
import { formaterMatricule, MATRICULE_PREFIX, prochainMatricule } from '../services/matricule';
import {
  analyserImportEleves,
  studentImportRequestSchema,
} from '../services/student-import';

const router = Router();
const studentSchema = z.object({
  matricule: z.string().trim().min(2),
  lastName: z.string().trim().min(2),
  firstNames: z.string().trim().min(2),
  birthDate: z.coerce.date(),
  birthPlace: z.string().trim().optional(),
  sex: z.string().trim().optional(),
  address: z.string().trim().optional(),
  guardianName: z.string().trim().optional(),
  guardianPhone: z.string().trim().optional(),
});
const studentCreateSchema = studentSchema.extend({
  matricule: z.string().trim().optional()
    .transform((value) => value || undefined)
    .refine((value) => value === undefined || value.length >= 2, {
      message: 'Le matricule doit contenir au moins deux caractères',
    }),
});
const enrollmentSchema = z.object({
  classroomId: z.string().min(1),
  isRepeating: z.boolean().default(false),
  entryType: z.enum(['NEW', 'TRANSFERRED']).optional(),
});
router.use(requireAuth, requireRole('SCHOOL_ADMIN', 'SURVEILLANT_GENERAL', 'ASSISTANT'));

router.get('/', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const students = await prisma.student.findMany({
    where: {
      schoolId,
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { matricule: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { firstNames: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    include: {
      enrollments: {
        where: { deletedAt: null, status: 'ACTIVE' },
        include: { classroom: { include: { academicYear: true } } },
      },
    },
    orderBy: [{ lastName: 'asc' }, { firstNames: 'asc' }],
  });
  res.json({ students });
}));

router.post('/import/preview', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const { students } = studentImportRequestSchema.parse(req.body);
  const rows = await analyserImportEleves(schoolId, students);
  res.json({
    rows: rows.map((item) => ({
      row: item.row,
      status: item.error ? 'ERROR' : item.candidates.length > 0 ? 'DUPLICATE' : 'READY',
      error: item.error ?? null,
      candidates: item.candidates.map((candidate) => ({
        ...candidate,
        birthDate: candidate.birthDate?.toISOString() ?? null,
        deletedAt: candidate.deletedAt?.toISOString() ?? null,
      })),
      classroom: item.classroom,
    })),
  });
}));

router.post('/import', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const { students: requests } = studentImportRequestSchema.parse(req.body);
  const rows = await analyserImportEleves(schoolId, requests);
  const requestByRow = new Map(requests.map((row) => [row.row, row]));
  const outcomes: Array<{
    row: number;
    matricule: string | null;
    status: 'created' | 'linked' | 'skipped';
    error?: string;
  }> = [];
  const ready: typeof rows = [];

  for (const row of rows) {
    const requestRow = requestByRow.get(row.row)!;
    const matricule = row.data?.matricule ?? row.candidates[0]?.matricule ?? null;
    if (row.error || !row.data) {
      outcomes.push({ row: row.row, matricule, status: 'skipped', error: row.error ?? 'Données invalides' });
      continue;
    }
    if (row.candidates.some((candidate) => candidate.deletedAt !== null)) {
      outcomes.push({
        row: row.row,
        matricule,
        status: 'skipped',
        error: 'Une fiche archivée correspond à cet élève; contactez l’administrateur avant import.',
      });
      continue;
    }
    if (row.candidates.length > 0) {
      if (requestRow.action !== 'LINK' || !row.candidates.some((candidate) => candidate.id === requestRow.candidateId)) {
        outcomes.push({
          row: row.row,
          matricule,
          status: 'skipped',
          error: 'Doublon potentiel détecté; confirmez le rattachement à une fiche existante.',
        });
        continue;
      }
    } else if (requestRow.action === 'LINK' || requestRow.candidateId) {
      outcomes.push({
        row: row.row,
        matricule,
        status: 'skipped',
        error: 'La fiche choisie ne correspond plus aux données importées.',
      });
      continue;
    }
    if (row.data.status !== 'NOUVEAU' && !row.classroom) {
      outcomes.push({
        row: row.row,
        matricule,
        status: 'skipped',
        error: 'Une classe est nécessaire pour enregistrer le statut de redoublement ou de transfert.',
      });
      continue;
    }
    ready.push(row);
  }

  const imported = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "School" WHERE "id" = ${schoolId} FOR UPDATE
    `;
    const existingMatricules = await transaction.student.findMany({
      where: { schoolId },
      select: { matricule: true },
    });
    const matriculesUtilises = new Set(
      existingMatricules.map((student) => student.matricule.toLocaleLowerCase('fr-FR')),
    );
    let prochainNumero = existingMatricules.reduce((maximum, student) => {
      const match = new RegExp(`^${MATRICULE_PREFIX}(\\d+)$`, 'i').exec(student.matricule);
      return match ? Math.max(maximum, Number.parseInt(match[1]!, 10)) : maximum;
    }, 0);

    const result: Array<{
      row: number;
      matricule: string | null;
      status: 'created' | 'linked' | 'skipped';
      error?: string;
      studentId?: string;
      classroomId?: string;
    }> = [];

    for (const row of ready) {
      const requestRow = requestByRow.get(row.row)!;
      const data = row.data!;
      let studentId: string;
      let matricule: string;
      let status: 'created' | 'linked';

      if (requestRow.action === 'LINK') {
        const candidate = row.candidates.find((item) => item.id === requestRow.candidateId)!;
        const current = await transaction.student.findFirst({
          where: { id: candidate.id, schoolId, deletedAt: null },
          select: { id: true, matricule: true },
        });
        if (!current) {
          result.push({
            row: row.row,
            matricule: candidate.matricule,
            status: 'skipped',
            error: 'La fiche sélectionnée n’existe plus ou a été archivée.',
          });
          continue;
        }
        studentId = current.id;
        matricule = current.matricule;
        status = 'linked';
      } else {
        matricule = data.matricule ?? '';
        const birthDateStart = new Date(Date.UTC(
          data.birthDate.getUTCFullYear(),
          data.birthDate.getUTCMonth(),
          data.birthDate.getUTCDate(),
        ));
        const birthDateEnd = new Date(birthDateStart.getTime() + 24 * 60 * 60 * 1000);
        const potentialDuplicate = await transaction.student.findFirst({
          where: {
            schoolId,
            OR: [
              ...(matricule
                ? [{ matricule: { equals: matricule, mode: 'insensitive' as const } }]
                : []),
              {
                lastName: { equals: data.lastName, mode: 'insensitive' },
                firstNames: { equals: data.firstNames, mode: 'insensitive' },
                birthDate: { gte: birthDateStart, lt: birthDateEnd },
              },
            ],
          },
          select: { id: true },
        });
        if (potentialDuplicate) {
          result.push({
            row: row.row,
            matricule: matricule || null,
            status: 'skipped',
            error: 'Doublon potentiel détecté depuis l’aperçu; vérifiez la fiche et confirmez son rattachement.',
          });
          continue;
        }
        if (!matricule) {
          do {
            prochainNumero += 1;
            matricule = formaterMatricule(MATRICULE_PREFIX, prochainNumero);
          } while (matriculesUtilises.has(matricule.toLocaleLowerCase('fr-FR')));
        }
        matriculesUtilises.add(matricule.toLocaleLowerCase('fr-FR'));
        const student = await transaction.student.create({
          data: {
            schoolId,
            matricule,
            lastName: data.lastName,
            firstNames: data.firstNames,
            birthDate: data.birthDate,
            birthPlace: data.birthPlace,
            sex: data.sex,
            address: data.address,
            guardianName: data.guardianName,
            guardianPhone: data.guardianPhone,
          },
        });
        studentId = student.id;
        status = 'created';
      }

      if (row.classroom) {
        const activeEnrollment = await transaction.enrollment.findFirst({
          where: { schoolId, studentId, status: 'ACTIVE', deletedAt: null },
          select: { id: true, classroomId: true },
        });
        if (activeEnrollment?.classroomId === row.classroom.id) {
          result.push({
            row: row.row,
            matricule,
            status: 'skipped',
            studentId,
          });
          continue;
        }
        if (activeEnrollment) {
          await transaction.enrollment.update({
            where: { id: activeEnrollment.id },
            data: { status: 'TRANSFERRED', endedAt: new Date() },
          });
        }
        await transaction.enrollment.create({
          data: {
            schoolId,
            studentId,
            classroomId: row.classroom.id,
            isRepeating: data.status === 'REDOUBLANT',
            entryType: data.status === 'TRANSFERE' ? 'TRANSFERRED' : 'NEW',
          },
        });
      }

      result.push({
        row: row.row,
        matricule,
        status,
        studentId,
        ...(row.classroom ? { classroomId: row.classroom.id } : {}),
      });
    }
    return result;
  });

  for (const item of imported) {
    if (item.status === 'skipped' || !item.studentId) {
      outcomes.push({
        row: item.row,
        matricule: item.matricule,
        status: 'skipped',
        error: item.error ?? "L'élève est déjà inscrit dans cette classe.",
      });
      continue;
    }
    outcomes.push({ row: item.row, matricule: item.matricule, status: item.status });
    await writeAuditLog({
      req,
      schoolId,
      userId: req.currentUser!.id,
      action: item.status === 'created' ? 'STUDENT_CREATED' : 'STUDENT_IMPORT_LINKED',
      entityType: 'Student',
      entityId: item.studentId,
      metadata: {
        source: 'IMPORT',
        row: item.row,
        ...(item.classroomId ? { classroomId: item.classroomId } : {}),
      },
    });
  }

  outcomes.sort((a, b) => a.row - b.row);
  const createdCount = outcomes.filter((item) => item.status === 'created').length;
  const linkedCount = outcomes.filter((item) => item.status === 'linked').length;
  res.status(201).json({
    importedCount: createdCount + linkedCount,
    createdCount,
    linkedCount,
    skippedCount: outcomes.filter((item) => item.status === 'skipped').length,
    results: outcomes,
  });
}));
router.get('/:id', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const student = await prisma.student.findFirst({
    where: { id: req.params.id, schoolId, deletedAt: null },
    include: {
      enrollments: {
        where: { deletedAt: null },
        include: {
          classroom: { include: { academicYear: true } },
          reportCards: {
            where: { deletedAt: null },
            select: { id: true, version: true, statut: true, semester: { select: { name: true } } },
            orderBy: [{ semester: { number: 'asc' } }, { version: 'desc' }],
          },
          annualSummaries: {
            where: { deletedAt: null },
            select: { id: true, version: true, statut: true, academicYear: { select: { name: true } } },
            orderBy: [{ academicYear: { startsAt: 'desc' } }, { version: 'desc' }],
          },
        },
        orderBy: { enrolledAt: 'desc' },
      },
    },
  });
  if (!student) throw new HttpError(404, 'Élève introuvable');
  res.json({ student });
}));
router.post('/', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const data = studentCreateSchema.parse(req.body);
  const matriculeManuel = data.matricule?.trim() || null;

  if (matriculeManuel) {
    const existing = await prisma.student.findFirst({
      where: { schoolId, matricule: { equals: matriculeManuel, mode: 'insensitive' } },
    });
    if (existing) throw new HttpError(409, 'Ce matricule existe déjà dans cet établissement');
  }

  let student: Awaited<ReturnType<typeof prisma.student.create>> | null = null;
  for (let tentative = 0; tentative < (matriculeManuel ? 1 : 5); tentative += 1) {
    const matricule = matriculeManuel ?? (await prochainMatricule(schoolId));
    try {
      student = await prisma.student.create({
        data: { ...data, matricule, schoolId },
      });
      break;
    } catch (error) {
      const conflitUnique =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002';
      if (!conflitUnique) throw error;
      if (matriculeManuel) {
        throw new HttpError(409, 'Ce matricule existe déjà dans cet établissement');
      }
    }
  }
  if (!student) {
    throw new HttpError(409, 'Impossible de générer un matricule disponible. Réessayez.');
  }

  await writeAuditLog({ req, schoolId, userId: req.currentUser!.id, action: 'STUDENT_CREATED', entityType: 'Student', entityId: student.id });
  res.status(201).json({ student });
}));
router.patch('/:id', requireCsrf, asyncHandler(async (req, res) => { const schoolId = requireSchoolId(req); const data = studentSchema.partial().parse(req.body); const student = await prisma.student.findFirst({ where: { id: req.params.id, schoolId, deletedAt: null } }); if (!student) throw new HttpError(404, 'Élève introuvable'); if (data.matricule && data.matricule !== student.matricule && await prisma.student.findFirst({ where: { schoolId, matricule: { equals: data.matricule, mode: 'insensitive' } } })) throw new HttpError(409, 'Ce matricule existe déjà dans cet établissement'); const updated = await prisma.student.update({ where: { id: student.id }, data }); await writeAuditLog({ req, schoolId, userId: req.currentUser!.id, action: 'STUDENT_UPDATED', entityType: 'Student', entityId: student.id }); res.json({ student: updated }); }));
router.post('/:id/enrollments', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const { classroomId, isRepeating, entryType: requestedEntryType } = enrollmentSchema.parse(req.body);
  const [student, classroom] = await Promise.all([
    prisma.student.findFirst({ where: { id: req.params.id, schoolId, deletedAt: null } }),
    prisma.classroom.findFirst({
      where: { id: classroomId, schoolId, deletedAt: null },
      include: { academicYear: true },
    }),
  ]);
  if (!student || !classroom) throw new HttpError(404, 'Élève ou classe introuvable');
  if (classroom.academicYear.status === 'CLOSED') {
    throw new HttpError(409, "L'année scolaire est clôturée");
  }
  const activeEnrollment = await prisma.enrollment.findFirst({
    where: { schoolId, studentId: student.id, status: 'ACTIVE', deletedAt: null },
  });
  if (activeEnrollment?.classroomId === classroom.id) {
    throw new HttpError(409, "L'élève est déjà inscrit dans cette classe");
  }
  const entryType = requestedEntryType ?? (activeEnrollment ? 'TRANSFERRED' : 'NEW');
  const enrollment = await prisma.$transaction(async (transaction) => {
    await transaction.enrollment.updateMany({
      where: { studentId: student.id, schoolId, status: 'ACTIVE', deletedAt: null },
      data: { status: 'TRANSFERRED', endedAt: new Date() },
    });
    return transaction.enrollment.create({
      data: { schoolId, studentId: student.id, classroomId, isRepeating, entryType },
    });
  });
  await writeAuditLog({
    req,
    schoolId,
    userId: req.currentUser!.id,
    action: 'STUDENT_TRANSFERRED',
    entityType: 'Student',
    entityId: student.id,
    metadata: { classroomId, isRepeating, entryType },
  });
  res.status(201).json({ message: 'Inscription créée', enrollment });
}));
router.delete('/:id', requireCsrf, asyncHandler(async (req, res) => { const schoolId = requireSchoolId(req); const student = await prisma.student.findFirst({ where: { id: req.params.id, schoolId, deletedAt: null } }); if (!student) throw new HttpError(404, 'Élève introuvable'); const archivedAt = new Date(); await prisma.$transaction([prisma.student.update({ where: { id: student.id }, data: { deletedAt: archivedAt } }), prisma.enrollment.updateMany({ where: { schoolId, studentId: student.id, status: 'ACTIVE', deletedAt: null }, data: { status: 'TRANSFERRED', endedAt: archivedAt } })]); await writeAuditLog({ req, schoolId, userId: req.currentUser!.id, action: 'STUDENT_ARCHIVED', entityType: 'Student', entityId: student.id }); res.status(204).end(); }));
export const studentsRouter = router;
