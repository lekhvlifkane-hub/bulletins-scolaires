import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { asyncHandler, HttpError } from '../lib/http';
import { requireCsrf } from '../lib/csrf';
import { requireAuth, requireRole } from '../middleware/auth';
import { requireSchoolId } from '../middleware/auth';
import { writeAuditLog } from '../services/audit';

const router = Router();
const studentSchema = z.object({ matricule: z.string().trim().min(2), lastName: z.string().trim().min(2), firstNames: z.string().trim().min(2), birthDate: z.coerce.date().optional(), birthPlace: z.string().trim().optional(), sex: z.string().trim().optional(), address: z.string().trim().optional(), guardianName: z.string().trim().optional(), guardianPhone: z.string().trim().optional() });
const enrollmentSchema = z.object({ classroomId: z.string().min(1) });
const studentImportSchema = z.object({
  students: z.array(z.object({ row: z.number().int().min(2), student: z.unknown() })).min(1).max(500),
});
router.use(requireAuth, requireRole('SCHOOL_ADMIN', 'SURVEILLANT_GENERAL', 'ASSISTANT'));

router.get('/', asyncHandler(async (req, res) => { const schoolId = requireSchoolId(req); const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''; const students = await prisma.student.findMany({ where: { schoolId, deletedAt: null, ...(search ? { OR: [{ matricule: { contains: search, mode: 'insensitive' } }, { lastName: { contains: search, mode: 'insensitive' } }, { firstNames: { contains: search, mode: 'insensitive' } }] } : {}) }, include: { enrollments: { where: { deletedAt: null, status: 'ACTIVE' }, include: { classroom: true } } }, orderBy: [{ lastName: 'asc' }, { firstNames: 'asc' }] }); res.json({ students }); }));
router.post('/import', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const { students: rows } = studentImportSchema.parse(req.body);
  const outcomes: Array<{
    row: number;
    matricule: string | null;
    status: 'created' | 'skipped';
    error?: string;
  }> = [];
  const validRows: Array<{ row: number; data: z.infer<typeof studentSchema> }> = [];
  const seen = new Set<string>();

  rows.forEach(({ row, student: value }) => {
    const parsed = studentSchema.safeParse(value);
    if (!parsed.success) {
      const matricule =
        typeof value === 'object' && value !== null && 'matricule' in value &&
        typeof value.matricule === 'string'
          ? value.matricule.trim()
          : null;
      outcomes.push({
        row,
        matricule,
        status: 'skipped',
        error: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      });
      return;
    }

    const key = parsed.data.matricule.toLocaleUpperCase('fr-FR');
    if (seen.has(key)) {
      outcomes.push({
        row,
        matricule: parsed.data.matricule,
        status: 'skipped',
        error: 'Matricule répété dans le fichier',
      });
      return;
    }
    seen.add(key);
    validRows.push({ row, data: parsed.data });
  });

  const existing = validRows.length
    ? await prisma.student.findMany({
        where: {
          schoolId,
          OR: validRows.map(({ data }) => ({
            matricule: { equals: data.matricule, mode: 'insensitive' },
          })),
        },
        select: { matricule: true },
      })
    : [];
  const existingIds = new Set(existing.map((student) => student.matricule.toLocaleUpperCase('fr-FR')));
  const toCreate = validRows.filter(({ data }) => !existingIds.has(data.matricule.toLocaleUpperCase('fr-FR')));

  for (const { row, data } of validRows) {
    if (existingIds.has(data.matricule.toLocaleUpperCase('fr-FR'))) {
      outcomes.push({
        row,
        matricule: data.matricule,
        status: 'skipped',
        error: 'Ce matricule existe déjà dans cet établissement',
      });
    }
  }

  const created = await prisma.$transaction(async (transaction) => {
    const result = [];
    for (const { data } of toCreate) {
      result.push(await transaction.student.create({ data: { ...data, schoolId } }));
    }
    return result;
  });

  for (let index = 0; index < created.length; index += 1) {
    const student = created[index];
    const row = toCreate[index].row;
    outcomes.push({ row, matricule: student.matricule, status: 'created' });
    await writeAuditLog({
      req,
      schoolId,
      userId: req.currentUser!.id,
      action: 'STUDENT_CREATED',
      entityType: 'Student',
      entityId: student.id,
      metadata: { source: 'CSV', row },
    });
  }

  outcomes.sort((a, b) => a.row - b.row);
  res.status(201).json({
    importedCount: created.length,
    skippedCount: outcomes.length - created.length,
    results: outcomes,
  });
}));
router.get('/:id', asyncHandler(async (req, res) => { const schoolId = requireSchoolId(req); const student = await prisma.student.findFirst({ where: { id: req.params.id, schoolId, deletedAt: null }, include: { enrollments: { where: { deletedAt: null }, include: { classroom: { include: { academicYear: true } } }, orderBy: { enrolledAt: 'desc' } } } }); if (!student) throw new HttpError(404, 'Élève introuvable'); res.json({ student }); }));
router.post('/', requireCsrf, asyncHandler(async (req, res) => { const schoolId = requireSchoolId(req); const data = studentSchema.parse(req.body); const existing = await prisma.student.findFirst({ where: { schoolId, matricule: { equals: data.matricule, mode: 'insensitive' } } }); if (existing) throw new HttpError(409, 'Ce matricule existe déjà dans cet établissement'); const student = await prisma.student.create({ data: { ...data, schoolId } }); await writeAuditLog({ req, schoolId, userId: req.currentUser!.id, action: 'STUDENT_CREATED', entityType: 'Student', entityId: student.id }); res.status(201).json({ student }); }));
router.patch('/:id', requireCsrf, asyncHandler(async (req, res) => { const schoolId = requireSchoolId(req); const data = studentSchema.partial().parse(req.body); const student = await prisma.student.findFirst({ where: { id: req.params.id, schoolId, deletedAt: null } }); if (!student) throw new HttpError(404, 'Élève introuvable'); if (data.matricule && data.matricule !== student.matricule && await prisma.student.findFirst({ where: { schoolId, matricule: { equals: data.matricule, mode: 'insensitive' } } })) throw new HttpError(409, 'Ce matricule existe déjà dans cet établissement'); const updated = await prisma.student.update({ where: { id: student.id }, data }); await writeAuditLog({ req, schoolId, userId: req.currentUser!.id, action: 'STUDENT_UPDATED', entityType: 'Student', entityId: student.id }); res.json({ student: updated }); }));
router.post('/:id/enrollments', requireCsrf, asyncHandler(async (req, res) => { const schoolId = requireSchoolId(req); const { classroomId } = enrollmentSchema.parse(req.body); const [student, classroom] = await Promise.all([prisma.student.findFirst({ where: { id: req.params.id, schoolId, deletedAt: null } }), prisma.classroom.findFirst({ where: { id: classroomId, schoolId, deletedAt: null }, include: { academicYear: true } })]); if (!student || !classroom) throw new HttpError(404, 'Élève ou classe introuvable'); if (classroom.academicYear.status === 'CLOSED') throw new HttpError(409, "L'année scolaire est clôturée"); const activeEnrollment = await prisma.enrollment.findFirst({ where: { schoolId, studentId: student.id, status: 'ACTIVE', deletedAt: null } }); if (activeEnrollment?.classroomId === classroom.id) throw new HttpError(409, "L'élève est déjà inscrit dans cette classe"); await prisma.$transaction([prisma.enrollment.updateMany({ where: { studentId: student.id, schoolId, status: 'ACTIVE', deletedAt: null }, data: { status: 'TRANSFERRED', endedAt: new Date() } }), prisma.enrollment.create({ data: { schoolId, studentId: student.id, classroomId } })]); await writeAuditLog({ req, schoolId, userId: req.currentUser!.id, action: 'STUDENT_TRANSFERRED', entityType: 'Student', entityId: student.id, metadata: { classroomId } }); res.status(201).json({ message: 'Inscription créée' }); }));
router.delete('/:id', requireCsrf, asyncHandler(async (req, res) => { const schoolId = requireSchoolId(req); const student = await prisma.student.findFirst({ where: { id: req.params.id, schoolId, deletedAt: null } }); if (!student) throw new HttpError(404, 'Élève introuvable'); const archivedAt = new Date(); await prisma.$transaction([prisma.student.update({ where: { id: student.id }, data: { deletedAt: archivedAt } }), prisma.enrollment.updateMany({ where: { schoolId, studentId: student.id, status: 'ACTIVE', deletedAt: null }, data: { status: 'TRANSFERRED', endedAt: archivedAt } })]); await writeAuditLog({ req, schoolId, userId: req.currentUser!.id, action: 'STUDENT_ARCHIVED', entityType: 'Student', entityId: student.id }); res.status(204).end(); }));
export const studentsRouter = router;
