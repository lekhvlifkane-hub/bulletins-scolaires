import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { asyncHandler, HttpError } from '../lib/http';
import { requireCsrf } from '../lib/csrf';
import { requireAuth, requireRole, requireSchoolId } from '../middleware/auth';
import { writeAuditLog } from '../services/audit';
import { ensureDefaultAppreciationRules } from '../services/appreciations/rules';
import { ensureDefaultLevels } from '../services/levels';
import { cleNiveau } from '../services/levels';
import { appliquerModelesALaClasse, ensureDefaultSubjects, MODELES_PAR_NIVEAU } from '../services/subjects/templates';

const router = Router();
const yearSchema = z.object({ name: z.string().trim().min(5), startsAt: z.coerce.date(), endsAt: z.coerce.date(), status: z.enum(['PREPARATION', 'ACTIVE', 'CLOSED']).optional() }).refine(v => v.endsAt > v.startsAt, { message: 'La date de fin doit être après la date de début' });
const yearUpdateSchema = z.object({ name: z.string().trim().min(5).optional(), startsAt: z.coerce.date().optional(), endsAt: z.coerce.date().optional(), status: z.enum(['PREPARATION', 'ACTIVE', 'CLOSED']).optional() });
const namedSchema = z.object({ name: z.string().trim().min(1), sortOrder: z.number().int().optional(), levelId: z.string().optional(), code: z.string().trim().min(1).optional() });
const classSchema = z.object({
  name: z.string().trim().min(1),
  academicYearId: z.string(),
  levelId: z.string(),
  seriesId: z.string().nullable().optional(),
  mainTeacherName: z.string().trim().max(120).nullish(),
});
const semesterDateSchema = z.object({
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
}).refine((value) => value.endsAt > value.startsAt, {
  message: 'La date de fin doit être après la date de début',
});
const classroomSubjectSchema = z.object({
  classroomId: z.string().min(1),
  subjectId: z.string().min(1),
  coefficient: z.union([z.coerce.number().min(0), z.string().min(1)]),
  teacherName: z.string().trim().max(120).nullish(),
  effectiveTo: z.coerce.date().nullable().optional(),
});
const coefficientUpdateSchema = z.object({
  coefficient: z.union([z.coerce.number().min(0), z.string().trim().min(1)]),
});
const teacherUpdateSchema = z.object({
  teacherName: z.string().trim().max(120).nullish(),
});
const subjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(60).optional(),
  levelId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  coefficient: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
  isChoice: z.boolean().optional(),
});
const subjectChoiceSchema = z.object({
  enrollmentId: z.string().min(1),
  subjectId: z.string().min(1),
});
const bulletinSettingsSchema = z.object({
  seuilPassage: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/),
  modeleBulletin: z.enum(['OFFICIEL', 'SIMPLE']),
  couleurPrimaire: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  couleurSecondaire: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  couleurAccent: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  drapeauDataUrl: z.string().max(2_000_000).nullable().optional(),
  logoMinistereDataUrl: z.string().max(2_000_000).nullable().optional(),
});
const appreciationRuleSchema = z.object({
  scope: z.enum(['MATIERE', 'MENTION', 'DECISION', 'GENERALE']),
  code: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(120),
  minScore: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/),
  maxScore: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/),
  content: z.string().trim().min(1).max(500),
  sortOrder: z.number().int().min(0).max(1000),
  isActive: z.boolean(),
}).strict().refine((rule) => {
  const minimum = Number(rule.minScore);
  const maximum = Number(rule.maxScore);
  return minimum >= 0 && maximum <= 20 && minimum <= maximum;
}, { message: 'Les seuils doivent être compris entre 0 et 20 et le minimum ne peut dépasser le maximum' });
const appreciationRulesUpdateSchema = z.object({
  rules: z.array(appreciationRuleSchema).min(1).max(40),
}).strict().superRefine(({ rules }, context) => {
  const seen = new Set<string>();
  for (const [index, rule] of rules.entries()) {
    const key = `${rule.scope}:${rule.code}`;
    if (seen.has(key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rules', index, 'code'],
        message: 'Code répété pour cette portée',
      });
    }
    seen.add(key);
  }
});
router.use(requireAuth, requireRole('SCHOOL_ADMIN', 'SURVEILLANT_GENERAL', 'ASSISTANT'));

router.get('/years', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const years = await prisma.academicYear.findMany({
    where: { schoolId, deletedAt: null },
    include: { semesters: { orderBy: { number: 'asc' } } },
    orderBy: { startsAt: 'desc' },
  });
  res.json({ years });
}));

router.post('/years', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const data = yearSchema.parse(req.body);
  const dureeJour = 24 * 60 * 60 * 1000;
  const jours = Math.floor((data.endsAt.getTime() - data.startsAt.getTime()) / dureeJour) + 1;
  if (jours < 2) throw new HttpError(400, "L'année scolaire doit durer au moins deux jours");
  const finPremierSemestre = new Date(data.startsAt.getTime() + Math.floor(jours / 2) * dureeJour - 1);
  const debutSecondSemestre = new Date(finPremierSemestre.getTime() + 1);

  const year = await prisma.$transaction(async (transaction) => {
    const created = await transaction.academicYear.create({
      data: { ...data, schoolId },
    });
    await transaction.semester.createMany({
      data: [
        {
          academicYearId: created.id,
          number: 1,
          name: 'Semestre 1',
          startsAt: data.startsAt,
          endsAt: finPremierSemestre,
        },
        {
          academicYearId: created.id,
          number: 2,
          name: 'Semestre 2',
          startsAt: debutSecondSemestre,
          endsAt: data.endsAt,
        },
      ],
    });
    return transaction.academicYear.findUniqueOrThrow({
      where: { id: created.id },
      include: { semesters: { orderBy: { number: 'asc' } } },
    });
  });
  await writeAuditLog({
    req,
    schoolId,
    userId: req.currentUser!.id,
    action: 'ACADEMIC_YEAR_CREATED',
    entityType: 'AcademicYear',
    entityId: year.id,
  });
  res.status(201).json({ year });
}));

router.patch('/years/:id', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const year = await prisma.academicYear.findFirst({
    where: { id: req.params.id, schoolId, deletedAt: null },
    include: { semesters: true },
  });
  if (!year) throw new HttpError(404, 'Année introuvable');
  if (year.status === 'CLOSED') throw new HttpError(409, "L'année scolaire est clôturée");
  const data = yearUpdateSchema.parse(req.body);
  const startsAt = data.startsAt ?? year.startsAt;
  const endsAt = data.endsAt ?? year.endsAt;
  if (endsAt <= startsAt) {
    throw new HttpError(400, 'La date de fin doit être après la date de début');
  }
  if (data.status === 'ACTIVE') {
    const autreAnneeActive = await prisma.academicYear.findFirst({
      where: {
        schoolId,
        deletedAt: null,
        status: 'ACTIVE',
        id: { not: year.id },
      },
    });
    if (autreAnneeActive) {
      throw new HttpError(409, 'Clôturez ou désactivez l’année scolaire active avant d’en activer une autre');
    }
  }
  if (data.startsAt || data.endsAt) {
    const semestreHorsPeriode = year.semesters.some(
      (semester) => semester.startsAt < startsAt || semester.endsAt > endsAt,
    );
    if (semestreHorsPeriode) {
      throw new HttpError(409, 'Les dates de l’année ne peuvent pas exclure un semestre');
    }
  }
  const updated = await prisma.academicYear.update({
    where: { id: year.id },
    data,
    include: { semesters: { orderBy: { number: 'asc' } } },
  });
  await writeAuditLog({
    req,
    schoolId,
    userId: req.currentUser!.id,
    action: 'ACADEMIC_YEAR_UPDATED',
    entityType: 'AcademicYear',
    entityId: year.id,
    metadata: data,
  });
  res.json({ year: updated });
}));

router.patch('/semesters/:id', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const data = semesterDateSchema.parse(req.body);
  const semester = await prisma.semester.findFirst({
    where: {
      id: req.params.id,
      academicYear: { schoolId, deletedAt: null },
    },
    include: { academicYear: true },
  });
  if (!semester) throw new HttpError(404, 'Semestre introuvable');
  if (semester.academicYear.status === 'CLOSED') {
    throw new HttpError(409, "L'année scolaire est clôturée");
  }
  if (
    data.startsAt < semester.academicYear.startsAt ||
    data.endsAt > semester.academicYear.endsAt
  ) {
    throw new HttpError(400, 'Les dates du semestre doivent rester dans celles de l’année scolaire');
  }
  const autreSemestre = await prisma.semester.findFirst({
    where: {
      academicYearId: semester.academicYearId,
      number: semester.number === 1 ? 2 : 1,
    },
  });
  if (
    autreSemestre &&
    (semester.number === 1
      ? data.endsAt >= autreSemestre.startsAt
      : data.startsAt <= autreSemestre.endsAt)
  ) {
    throw new HttpError(409, 'Les périodes des deux semestres ne peuvent pas se chevaucher');
  }
  const updated = await prisma.semester.update({
    where: { id: semester.id },
    data,
  });
  await writeAuditLog({
    req,
    schoolId,
    userId: req.currentUser!.id,
    action: 'SEMESTER_DATES_UPDATED',
    entityType: 'Semester',
    entityId: semester.id,
    metadata: data,
  });
  res.json({ semester: updated });
}));
router.get('/levels', asyncHandler(async(req,res)=>{const schoolId=requireSchoolId(req);await ensureDefaultLevels(schoolId);res.json({levels:await prisma.level.findMany({where:{schoolId,deletedAt:null},orderBy:[{sortOrder:'asc'},{name:'asc'}]})});}));
router.post('/levels', requireCsrf, asyncHandler(async(req,res)=>{const schoolId=requireSchoolId(req);const data=namedSchema.parse(req.body);const level=await prisma.level.create({data:{schoolId,name:data.name,sortOrder:data.sortOrder??0}});res.status(201).json({level});}));
router.get('/series', asyncHandler(async(req,res)=>{const schoolId=requireSchoolId(req);await ensureDefaultLevels(schoolId);res.json({series:await prisma.series.findMany({where:{schoolId,deletedAt:null},include:{level:true},orderBy:{name:'asc'}})});}));
router.post('/series', requireCsrf, asyncHandler(async(req,res)=>{const schoolId=requireSchoolId(req);const data=namedSchema.parse(req.body);if(data.levelId&&!await prisma.level.findFirst({where:{id:data.levelId,schoolId,deletedAt:null}}))throw new HttpError(404,'Niveau introuvable');const series=await prisma.series.create({data:{schoolId,name:data.name,levelId:data.levelId}});res.status(201).json({series});}));
router.get('/classes', asyncHandler(async(req,res)=>{const schoolId=requireSchoolId(req);res.json({classes:await prisma.classroom.findMany({where:{schoolId,deletedAt:null},include:{academicYear:true,level:true,series:true,_count:{select:{enrollments:{where:{status:'ACTIVE',deletedAt:null}}}}},orderBy:{name:'asc'}})});}));
router.post('/classes', requireCsrf, asyncHandler(async(req,res)=>{const schoolId=requireSchoolId(req);const data=classSchema.parse(req.body);const year=await prisma.academicYear.findFirst({where:{id:data.academicYearId,schoolId,deletedAt:null}});const level=await prisma.level.findFirst({where:{id:data.levelId,schoolId,deletedAt:null}});if(!year||!level)throw new HttpError(404,'Année ou niveau introuvable');if(year.status==='CLOSED')throw new HttpError(409,"L'année scolaire est clôturée");const classroom=await prisma.classroom.create({data:{...data,schoolId}});const modeles=await appliquerModelesALaClasse({schoolId,classroomId:classroom.id});res.status(201).json({classroom,modeles});}));

/**
 * @openapi
 * /api/schooling/classes/{id}/apply-subject-templates:
 *   post:
 *     summary: Appliquer les modèles de matières du niveau à une classe
 *     tags: [Disciplines et réglages]
 *     description: >
 *       Crée uniquement les matières manquantes dans la classe. L'opération est idempotente
 *       et n'écrase pas les coefficients existants. Le jeton CSRF est requis.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Identifiant de la classe
 *     responses:
 *       200: { description: Matières ajoutées et modèle du niveau appliqué }
 *       404: { description: Classe introuvable dans l'établissement }
 */
router.post('/classes/:id/apply-subject-templates', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const classroom = await prisma.classroom.findFirst({ where: { id: req.params.id, schoolId, deletedAt: null } });
  if (!classroom) throw new HttpError(404, 'Classe introuvable');
  const appli = await appliquerModelesALaClasse({ schoolId, classroomId: classroom.id });
  const niveau = classroom.levelId
    ? (await prisma.level.findFirst({ where: { id: classroom.levelId, schoolId }, select: { name: true } }))?.name ?? ''
    : '';
  const modeles = [
    { niveau, nom: `Modèle ${niveau || 'du niveau'}`, matieres: MODELES_PAR_NIVEAU[cleNiveau(niveau)] ?? [] },
  ];
  await writeAuditLog({
    req,
    schoolId,
    userId: req.currentUser!.id,
    action: 'SUBJECT_TEMPLATES_APPLIED',
    entityType: 'Classroom',
    entityId: classroom.id,
    metadata: appli,
  });
  res.json({ ...appli, modeles });
}));
router.patch('/classes/:id', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const data = classSchema
    .pick({ name: true, seriesId: true, mainTeacherName: true })
    .partial()
    .parse(req.body);
  const classroom = await prisma.classroom.findFirst({
    where: { id: req.params.id, schoolId, deletedAt: null },
    include: { academicYear: true },
  });
  if (!classroom) throw new HttpError(404, 'Classe introuvable');
  if (classroom.academicYear.status === 'CLOSED') {
    throw new HttpError(409, "L'année scolaire est clôturée");
  }
  const updated = await prisma.classroom.update({
    where: { id: classroom.id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.seriesId !== undefined ? { seriesId: data.seriesId } : {}),
      ...(data.mainTeacherName !== undefined
        ? { mainTeacherName: data.mainTeacherName?.trim() || null }
        : {}),
    },
    include: {
      academicYear: true,
      level: true,
      series: true,
      _count: { select: { enrollments: { where: { status: 'ACTIVE', deletedAt: null } } } },
    },
  });
  await writeAuditLog({
    req,
    schoolId,
    userId: req.currentUser!.id,
    action: 'CLASSROOM_UPDATED',
    entityType: 'Classroom',
    entityId: updated.id,
    metadata: { ...data },
  });
  res.json({ classroom: updated });
}));
/**
 * @openapi
 * /api/schooling/subjects:
 *   get:
 *     summary: Lister les matières de l'établissement
 *     tags: [Disciplines et réglages]
 *     description: >
 *       Retourne les matières par niveau avec leur parent, leur coefficient et leur ordre.
 *       Les modèles officiels 6e à 3e sont créés automatiquement s'ils sont absents.
 *     responses:
 *       200: { description: Liste des matières actives et inactives }
 *   post:
 *     summary: Créer une matière
 *     tags: [Disciplines et réglages]
 *     description: >
 *       `levelId` et `parentId` doivent appartenir à l'établissement. `isChoice` marque une
 *       option réellement sélectionnable ; le LV2 générique reste exclu des choix. Jeton CSRF requis.
 *     responses:
 *       201: { description: Matière créée }
 *       404: { description: Niveau ou matière parente introuvable }
 * /api/schooling/subjects/{id}:
 *   patch:
 *     summary: Modifier une matière
 *     tags: [Disciplines et réglages]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Matière mise à jour }
 *       400: { description: Une matière ne peut pas être son propre parent }
 *       404: { description: Matière ou matière parente introuvable }
 *   delete:
 *     summary: Supprimer logiquement une matière
 *     tags: [Disciplines et réglages]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204: { description: Matière désactivée et masquée }
 *       404: { description: Matière introuvable }
 */
router.get('/subjects', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  await ensureDefaultSubjects(schoolId);
  const subjects = await prisma.subject.findMany({
    where: { schoolId, deletedAt: null },
    include: { level: true, parent: true },
    orderBy: [{ level: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
  });
  res.json({
    subjects: subjects.map((subject) => ({
      ...subject,
      coefficient: String(subject.coefficient),
    })),
  });
}));

router.post('/subjects', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const data = subjectSchema.parse(req.body);
  if (data.levelId && !await prisma.level.findFirst({ where: { id: data.levelId, schoolId, deletedAt: null } })) {
    throw new HttpError(404, 'Niveau introuvable');
  }
  if (data.parentId && !await prisma.subject.findFirst({ where: { id: data.parentId, schoolId, deletedAt: null } })) {
    throw new HttpError(404, 'Matière parente introuvable');
  }
  const code = data.code ?? data.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const subject = await prisma.subject.create({
    data: {
      schoolId,
      name: data.name,
      code,
      levelId: data.levelId ?? null,
      parentId: data.parentId ?? null,
      coefficient: data.coefficient ?? '1',
      sortOrder: data.sortOrder ?? 0,
      isActive: data.isActive ?? true,
      isChoice: data.isChoice ?? false,
    },
  });
  await writeAuditLog({
    req,
    schoolId,
    userId: req.currentUser!.id,
    action: 'SUBJECT_CREATED',
    entityType: 'Subject',
    entityId: subject.id,
    metadata: { name: subject.name, code: subject.code },
  });
  res.status(201).json({ subject: { ...subject, coefficient: String(subject.coefficient) } });
}));

router.patch('/subjects/:id', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const data = subjectSchema.partial().parse(req.body);
  const current = await prisma.subject.findFirst({ where: { id: req.params.id, schoolId, deletedAt: null } });
  if (!current) throw new HttpError(404, 'Matière introuvable');
  if (data.parentId === current.id) throw new HttpError(400, 'Une matière ne peut pas être son propre parent');
  if (data.parentId && !await prisma.subject.findFirst({ where: { id: data.parentId, schoolId, deletedAt: null } })) {
    throw new HttpError(404, 'Matière parente introuvable');
  }
  const updated = await prisma.subject.update({
    where: { id: current.id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.code !== undefined ? { code: data.code } : {}),
      ...(data.levelId !== undefined ? { levelId: data.levelId } : {}),
      ...(data.parentId !== undefined ? { parentId: data.parentId } : {}),
      ...(data.coefficient !== undefined ? { coefficient: new Prisma.Decimal(data.coefficient) } : {}),
      ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.isChoice !== undefined ? { isChoice: data.isChoice } : {}),
    },
  });
  await writeAuditLog({
    req,
    schoolId,
    userId: req.currentUser!.id,
    action: 'SUBJECT_UPDATED',
    entityType: 'Subject',
    entityId: updated.id,
    metadata: data,
  });
  res.json({ subject: { ...updated, coefficient: String(updated.coefficient) } });
}));

router.delete('/subjects/:id', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const subject = await prisma.subject.findFirst({ where: { id: req.params.id, schoolId, deletedAt: null } });
  if (!subject) throw new HttpError(404, 'Matière introuvable');
  await prisma.subject.update({ where: { id: subject.id }, data: { deletedAt: new Date(), isActive: false } });
  await writeAuditLog({
    req,
    schoolId,
    userId: req.currentUser!.id,
    action: 'SUBJECT_DELETED',
    entityType: 'Subject',
    entityId: subject.id,
  });
  res.status(204).end();
}));
/**
 * @openapi
 * /api/schooling/classroom-subjects:
 *   get:
 *     summary: Affectations discipline/classe avec coefficient
 *     tags: [Disciplines et réglages]
 *     description: >
 *       C'est sur une affectation que l'évaluation est créée ; son coefficient est la version
 *       effective utilisée au calcul. Les lignes incluent la classe et la matière parente.
 *     parameters:
 *       - in: query
 *         name: classroomId
 *         schema: { type: string }
 *         description: Filtre sur une classe ; sans filtre, toutes les affectations sont renvoyées
 *     responses:
 *       200: { description: Affectations triées par classe et ordre d'affichage }
 */
router.get('/classroom-subjects', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const classroomId = typeof req.query.classroomId === 'string' ? req.query.classroomId : '';
  const rows = await prisma.classroomSubject.findMany({
    where: { schoolId, ...(classroomId ? { classroomId } : {}) },
    // Le front (page Matières) affiche classroom.level.name, classroom.series.name
    // et classroom.academicYear.name : il faut donc inclure ces relations, sinon
    // la page plante (« Cannot read properties of undefined »).
    include: {
      subject: { include: { parent: true } },
      classroom: { include: { academicYear: true, level: true, series: true } },
    },
    orderBy: [{ classroom: { name: 'asc' } }, { sortOrder: 'asc' }, { subject: { name: 'asc' } }],
  });
  res.json({
    classroomSubjects: rows.map((row) => ({ ...row, coefficient: String(row.coefficient) })),
  });
}));

/**
 * @openapi
 * /api/schooling/appreciation-rules:
 *   get:
 *     summary: Règles d'appréciation automatique de l'établissement
 *     tags: [Disciplines et réglages]
 *     description: Les règles par défaut sont créées automatiquement si l'établissement n'en a pas.
 *     responses:
 *       200: { description: Règles actives et libellés configurables }
 *   put:
 *     summary: Remplacer les règles d'appréciation automatique
 *     tags: [Disciplines et réglages]
 *     description: >
 *       Accepte entre 1 et 40 règles, avec des seuils compris entre 0 et 20 et un code unique
 *       par portée. Jeton CSRF requis.
 *     responses:
 *       200: { description: Règles enregistrées }
 *       400: { description: Seuils ou codes invalides }
 */
router.get('/appreciation-rules', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  await ensureDefaultAppreciationRules(schoolId);
  const rules = await prisma.appreciationRule.findMany({
    where: { schoolId, deletedAt: null },
    orderBy: [{ scope: 'asc' }, { sortOrder: 'asc' }, { minScore: 'asc' }],
  });
  res.json({
    rules: rules.map((rule) => ({
      ...rule,
      minScore: rule.minScore === null ? null : String(rule.minScore),
      maxScore: rule.maxScore === null ? null : String(rule.maxScore),
    })),
  });
}));

router.put('/appreciation-rules', requireCsrf, asyncHandler(async (req, res) => {
  if (req.currentUser!.role !== 'SCHOOL_ADMIN') {
    throw new HttpError(403, 'Seul l’administrateur de l’établissement peut modifier ces règles');
  }
  const schoolId = requireSchoolId(req);
  const { rules } = appreciationRulesUpdateSchema.parse(req.body);
  const saved = await prisma.$transaction(
    rules.map((rule) =>
      prisma.appreciationRule.upsert({
        where: {
          schoolId_scope_code: { schoolId, scope: rule.scope, code: rule.code },
        },
        create: {
          schoolId,
          ...rule,
          minScore: new Prisma.Decimal(rule.minScore),
          maxScore: new Prisma.Decimal(rule.maxScore),
        },
        update: {
          label: rule.label,
          minScore: new Prisma.Decimal(rule.minScore),
          maxScore: new Prisma.Decimal(rule.maxScore),
          content: rule.content,
          sortOrder: rule.sortOrder,
          isActive: rule.isActive,
          deletedAt: null,
        },
      }),
    ),
  );
  await writeAuditLog({
    req,
    schoolId,
    userId: req.currentUser!.id,
    action: 'APPRECIATION_RULES_UPDATED',
    entityType: 'AppreciationRule',
    metadata: { count: saved.length },
  });
  res.json({
    rules: saved.map((rule) => ({
      ...rule,
      minScore: rule.minScore === null ? null : String(rule.minScore),
      maxScore: rule.maxScore === null ? null : String(rule.maxScore),
    })),
  });
}));

router.post('/classroom-subjects', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const data = classroomSubjectSchema.parse(req.body);
  const coefficient = Number(String(data.coefficient).replace(',', '.'));
  if (!Number.isFinite(coefficient) || coefficient < 0) {
    throw new HttpError(400, 'Coefficient invalide : nombre décimal positif attendu');
  }

  const [classroom, subject] = await Promise.all([
    prisma.classroom.findFirst({
      where: { id: data.classroomId, schoolId, deletedAt: null },
      include: { academicYear: true },
    }),
    prisma.subject.findFirst({ where: { id: data.subjectId, schoolId, deletedAt: null } }),
  ]);
  if (!classroom) throw new HttpError(404, 'Classe introuvable');
  if (!subject) throw new HttpError(404, 'Discipline introuvable');
  if (classroom.academicYear.status === 'CLOSED') {
    throw new HttpError(409, "L'année scolaire est clôturée");
  }

  const existante = await prisma.classroomSubject.findFirst({
    where: { classroomId: classroom.id, subjectId: subject.id, effectiveTo: null },
  });
  if (existante) {
    throw new HttpError(409, 'Cette discipline est déjà affectée à cette classe (modifiable en coefficient)');
  }

  const created = await prisma.classroomSubject.create({
    data: {
      schoolId,
      classroomId: classroom.id,
      subjectId: subject.id,
      coefficient: new Prisma.Decimal(String(coefficient)),
      teacherName: data.teacherName?.trim() || null,
      ...(data.effectiveTo ? { effectiveTo: data.effectiveTo } : {}),
    },
    include: { subject: true, classroom: true },
  });
  await writeAuditLog({
    req,
    schoolId,
    userId: req.currentUser!.id,
    action: 'CLASSROOM_SUBJECT_CREATED',
    entityType: 'ClassroomSubject',
    entityId: created.id,
    metadata: { classroomId: classroom.id, subjectId: subject.id, coefficient: String(coefficient) },
  });
  res.status(201).json({ classroomSubject: { ...created, coefficient: String(created.coefficient) } });
}));

router.patch('/classroom-subjects/:id/coefficient', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const data = coefficientUpdateSchema.parse(req.body);
  const coefficientText = String(data.coefficient).replace(',', '.');
  const coefficient = Number(coefficientText);
  if (!Number.isFinite(coefficient) || coefficient < 0 || coefficient > 9999.99 ||
      !/^\d+(\.\d{1,2})?$/.test(coefficientText)) {
    throw new HttpError(400, 'Coefficient invalide : utilisez un nombre positif avec au plus deux décimales');
  }

  const current = await prisma.classroomSubject.findFirst({
    where: { id: req.params.id, schoolId, effectiveTo: null },
    include: { classroom: { include: { academicYear: true } }, subject: true },
  });
  if (!current) throw new HttpError(404, 'Affectation de discipline introuvable');
  if (current.classroom.academicYear.status === 'CLOSED') {
    throw new HttpError(409, "L'année scolaire est clôturée");
  }
  if (current.coefficient.equals(new Prisma.Decimal(coefficientText))) {
    throw new HttpError(400, 'Le nouveau coefficient est identique au coefficient actuel');
  }

  const effectiveFrom = new Date();
  const created = await prisma.$transaction(async (transaction) => {
    const closed = await transaction.classroomSubject.updateMany({
      where: { id: current.id, schoolId, effectiveTo: null },
      data: { effectiveTo: effectiveFrom },
    });
    if (closed.count !== 1) {
      throw new HttpError(409, 'Le coefficient a déjà été modifié. Rechargez la page avant de réessayer.');
    }
    return transaction.classroomSubject.create({
      data: {
        schoolId,
        classroomId: current.classroomId,
        subjectId: current.subjectId,
        coefficient: new Prisma.Decimal(coefficientText),
        teacherName: current.teacherName,
        effectiveFrom,
      },
      include: { subject: true, classroom: true },
    });
  });

  await writeAuditLog({
    req,
    schoolId,
    userId: req.currentUser!.id,
    action: 'CLASSROOM_SUBJECT_COEFFICIENT_UPDATED',
    entityType: 'ClassroomSubject',
    entityId: created.id,
    metadata: {
      classroomId: current.classroomId,
      subjectId: current.subjectId,
      previousAssignmentId: current.id,
      previousCoefficient: String(current.coefficient),
      coefficient: coefficientText,
      effectiveFrom: effectiveFrom.toISOString(),
    },
  });
  res.status(201).json({
    classroomSubject: { ...created, coefficient: String(created.coefficient) },
  });
}));

router.patch('/classroom-subjects/:id/teacher', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const { teacherName } = teacherUpdateSchema.parse(req.body);
  const current = await prisma.classroomSubject.findFirst({
    where: { id: req.params.id, schoolId, effectiveTo: null },
    include: { classroom: { include: { academicYear: true } }, subject: true },
  });
  if (!current) throw new HttpError(404, 'Affectation de discipline introuvable');
  if (current.classroom.academicYear.status === 'CLOSED') {
    throw new HttpError(409, "L'année scolaire est clôturée");
  }
  const normalized = teacherName?.trim() || null;
  if (normalized === current.teacherName) {
    throw new HttpError(400, 'Le nom de l’enseignant est identique à la valeur actuelle');
  }
  const updated = await prisma.classroomSubject.update({
    where: { id: current.id },
    data: { teacherName: normalized },
    include: { subject: true, classroom: true },
  });
  await writeAuditLog({
    req,
    schoolId,
    userId: req.currentUser!.id,
    action: 'CLASSROOM_SUBJECT_TEACHER_UPDATED',
    entityType: 'ClassroomSubject',
    entityId: updated.id,
    metadata: {
      subjectId: current.subjectId,
      classroomId: current.classroomId,
      previousTeacherName: current.teacherName,
      teacherName: normalized,
    },
  });
  res.json({
    classroomSubject: { ...updated, coefficient: String(updated.coefficient) },
  });
}));
/**
 * @openapi
 * /api/schooling/bulletin-settings:
 *   get:
 *     summary: Paramètres du bulletin officiel
 *     tags: [Disciplines et réglages]
 *     responses:
 *       200: { description: Seuil de passage, modèle, couleurs, drapeau et logo du Ministère }
 *       404: { description: Établissement introuvable }
 *   patch:
 *     summary: Modifier les paramètres du bulletin officiel
 *     tags: [Disciplines et réglages]
 *     description: >
 *       Réservé à l'administrateur d'établissement. Les images sont des data URLs PNG ou JPEG
 *       de 2 Mio maximum. Jeton CSRF requis.
 *     responses:
 *       200: { description: Paramètres enregistrés }
 *       403: { description: Réservé à l'administrateur d'établissement }
 *       400: { description: Seuil, modèle, couleur ou image invalide }
 */
router.get('/bulletin-settings', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const school = await prisma.school.findFirst({
    where: { id: schoolId, deletedAt: null },
    select: {
      seuilPassage: true,
      modeleBulletin: true,
      couleurPrimaire: true,
      couleurSecondaire: true,
      couleurAccent: true,
      drapeauDataUrl: true,
      logoMinistereDataUrl: true,
    },
  });
  if (!school) throw new HttpError(404, 'Établissement introuvable');
  res.json({
    settings: {
      ...school,
      seuilPassage: String(school.seuilPassage),
    },
  });
}));

router.patch('/bulletin-settings', requireCsrf, asyncHandler(async (req, res) => {
  if (req.currentUser!.role !== 'SCHOOL_ADMIN') {
    throw new HttpError(403, 'Seul l’administrateur peut modifier ces paramètres');
  }
  const schoolId = requireSchoolId(req);
  const data = bulletinSettingsSchema.parse(req.body);
  const updated = await prisma.school.update({
    where: { id: schoolId },
    data: {
      seuilPassage: new Prisma.Decimal(data.seuilPassage),
      modeleBulletin: data.modeleBulletin,
      couleurPrimaire: data.couleurPrimaire,
      couleurSecondaire: data.couleurSecondaire,
      couleurAccent: data.couleurAccent,
      ...(data.drapeauDataUrl !== undefined ? { drapeauDataUrl: data.drapeauDataUrl } : {}),
      ...(data.logoMinistereDataUrl !== undefined ? { logoMinistereDataUrl: data.logoMinistereDataUrl } : {}),
    },
    select: {
      seuilPassage: true,
      modeleBulletin: true,
      couleurPrimaire: true,
      couleurSecondaire: true,
      couleurAccent: true,
      drapeauDataUrl: true,
      logoMinistereDataUrl: true,
    },
  });
  await writeAuditLog({
    req,
    schoolId,
    userId: req.currentUser!.id,
    action: 'BULLETIN_SETTINGS_UPDATED',
    entityType: 'School',
    entityId: schoolId,
    metadata: data,
  });
  res.json({ settings: { ...updated, seuilPassage: String(updated.seuilPassage) } });
}));

/**
 * @openapi
 * /api/schooling/subject-choices:
 *   get:
 *     summary: Options choisies par les élèves d'une classe
 *     tags: [Disciplines et réglages]
 *     description: Retourne les choix existants et la liste des options sélectionnables.
 *     parameters:
 *       - in: query
 *         name: classroomId
 *         schema: { type: string }
 *         description: Filtre sur une classe ; sans filtre, tous les choix sont renvoyés
 *     responses:
 *       200: { description: Choix par inscription et options actives }
 *   put:
 *     summary: Enregistrer l'option d'un élève
 *     tags: [Disciplines et réglages]
 *     description: >
 *       Une seule option active par inscription. Les matières `isChoice` sont acceptées, sauf
 *       le LV2 générique dont le code se termine par `_LV2`. Jeton CSRF requis.
 *     responses:
 *       200: { description: Choix créé ou remplacé }
 *       404: { description: Inscription ou matière à choix introuvable }
 */
router.get('/subject-choices', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const classroomId = typeof req.query.classroomId === 'string' ? req.query.classroomId : '';
  const choices = await prisma.studentSubjectChoice.findMany({
    where: {
      schoolId,
      ...(classroomId ? { enrollment: { classroomId } } : {}),
    },
    include: { enrollment: { include: { student: true } }, subject: true },
    orderBy: [{ enrollment: { student: { lastName: 'asc' } } }],
  });
  const options = await prisma.subject.findMany({
    where: { schoolId, deletedAt: null, isActive: true, isChoice: true },
    orderBy: { sortOrder: 'asc' },
  });
  res.json({ choices, options });
}));

router.put('/subject-choices', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const data = subjectChoiceSchema.parse(req.body);
  const [enrollment, subject] = await Promise.all([
    prisma.enrollment.findFirst({ where: { id: data.enrollmentId, schoolId, deletedAt: null } }),
    prisma.subject.findFirst({ where: { id: data.subjectId, schoolId, deletedAt: null, isChoice: true } }),
  ]);
  if (!enrollment) throw new HttpError(404, 'Inscription introuvable');
  if (!subject || subject.code.endsWith('_LV2')) throw new HttpError(404, 'Matière à choix introuvable');
  const choice = await prisma.studentSubjectChoice.upsert({
    where: { enrollmentId: enrollment.id },
    create: { schoolId, enrollmentId: enrollment.id, subjectId: subject.id },
    update: { subjectId: subject.id },
  });
  await writeAuditLog({
    req,
    schoolId,
    userId: req.currentUser!.id,
    action: 'SUBJECT_CHOICE_UPDATED',
    entityType: 'StudentSubjectChoice',
    entityId: choice.id,
    metadata: { enrollmentId: enrollment.id, subjectId: subject.id },
  });
  res.json({ choice });
}));

export const schoolingRouter=router;
