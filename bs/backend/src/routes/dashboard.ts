import { Router } from 'express';
import { prisma } from '../db/prisma';
import { asyncHandler } from '../lib/http';
import { requireAuth, requireSchoolId } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

/**
 * @openapi
 * /api/dashboard:
 *   get:
 *     summary: Indicateurs agrégés du tableau de bord selon le périmètre du compte
 *     tags: [Tableau de bord]
 *     responses:
 *       200: { description: Indicateurs plateforme ou établissement ; les données scolaires sont filtrées par établissement }
 *       401: { description: Session requise }
 */
router.get('/', asyncHandler(async (req, res) => {
  const user = req.currentUser!;
  if (user.role === 'PLATFORM_ADMIN') {
    const [schools, activeSchools, users] = await Promise.all([
      prisma.school.count({ where: { deletedAt: null } }),
      prisma.school.count({ where: { deletedAt: null, isActive: true } }),
      prisma.user.count({ where: { deletedAt: null } }),
    ]);
    res.json({ scope: 'platform', indicators: { schools, activeSchools, users } });
    return;
  }

  const schoolId = requireSchoolId(req);
  const year = await prisma.academicYear.findFirst({
    where: { schoolId, deletedAt: null, status: 'ACTIVE' },
    include: { semesters: { orderBy: { number: 'asc' } } },
    orderBy: { startsAt: 'desc' },
  });
  const [students, classrooms, subjects, evaluationTypes, assessments, reportCards, attendance, enrollments, school] = await Promise.all([
    prisma.student.count({ where: { schoolId, deletedAt: null } }),
    prisma.classroom.count({
      where: { schoolId, deletedAt: null, ...(year ? { academicYearId: year.id } : {}) },
    }),
    prisma.subject.count({ where: { schoolId, deletedAt: null } }),
    // Sert à la liste de contrôle « Premiers pas » du tableau de bord : une
    // évaluation ne peut être créée sans type (devoir, composition…).
    prisma.assessmentType.count({ where: { schoolId, deletedAt: null } }),
    prisma.assessment.groupBy({
      by: ['status'],
      where: { schoolId, deletedAt: null, ...(year ? { semester: { academicYearId: year.id } } : {}) },
      _count: { _all: true },
    }),
    prisma.reportCard.groupBy({
      by: ['semesterId', 'statut'],
      where: {
        schoolId,
        estCourant: true,
        deletedAt: null,
        ...(year ? { academicYearId: year.id } : {}),
      },
      _count: { _all: true },
    }),
    prisma.attendanceRecord.groupBy({
      by: ['semesterId', 'kind'],
      where: {
        schoolId,
        deletedAt: null,
        ...(year ? { semester: { academicYearId: year.id } } : {}),
      },
      _count: { _all: true },
    }),
    prisma.enrollment.count({
      where: {
        schoolId,
        status: 'ACTIVE',
        deletedAt: null,
        ...(year ? { classroom: { academicYearId: year.id } } : {}),
      },
    }),
    prisma.school.findFirst({ where: { id: schoolId }, select: { name: true } }),
  ]);

  res.json({
    scope: 'school',
    schoolName: school?.name ?? null,
    academicYear: year ? { id: year.id, name: year.name } : null,
    indicators: {
      students,
      enrollments,
      classrooms,
      subjects,
      evaluationTypes,
      assessments: assessments.reduce((total, row) => total + row._count._all, 0),
      bulletins: reportCards.reduce((total, row) => total + row._count._all, 0),
      publishedBulletins: reportCards
        .filter((row) => row.statut === 'PUBLIE')
        .reduce((total, row) => total + row._count._all, 0),
    },
    semesters: (year?.semesters ?? []).map((semester) => ({
      id: semester.id,
      name: semester.name,
      numero: semester.number,
      bulletins: reportCards
        .filter((row) => row.semesterId === semester.id)
        .reduce((total, row) => total + row._count._all, 0),
      bulletinsPublies: reportCards
        .filter((row) => row.semesterId === semester.id && row.statut === 'PUBLIE')
        .reduce((total, row) => total + row._count._all, 0),
      absences: attendance
        .filter((row) => row.semesterId === semester.id && row.kind === 'ABSENCE')
        .reduce((total, row) => total + row._count._all, 0),
      retards: attendance
        .filter((row) => row.semesterId === semester.id && row.kind === 'RETARD')
        .reduce((total, row) => total + row._count._all, 0),
    })),
  });
}));

export const dashboardRouter = router;
