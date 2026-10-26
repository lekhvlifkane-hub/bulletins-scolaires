import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { asyncHandler, HttpError } from '../lib/http';
import { requireCsrf } from '../lib/csrf';
import { requireAuth, requireRole, requireSchoolId } from '../middleware/auth';
import { writeAuditLog } from '../services/audit';
import { calculerBilanAnnuel, calculerResultatsClasse } from '../services/calcul/resultats';
import { formaterNote } from '../services/calcul';
import { parametresEtablissement } from '../services/calcul/etablissement';

const router = Router();

const CATEGORIES = ['DEVOIR', 'COMPOSITION', 'AUTRE'] as const;
const STATUTS_EVALUATION = ['BOUILLON', 'SAISIE_EN_COURS', 'A_VERIFIER', 'VALIDEE', 'PUBLIEE'] as const;
const STATUTS_NOTE = ['SAISIE', 'ABSENT', 'ANNULEE', 'NON_SAISIE'] as const;

/** Transitions autorisées du workflow d'une évaluation. */
const TRANSITIONS: Record<(typeof STATUTS_EVALUATION)[number], readonly string[]> = {
  BOUILLON: ['SAISIE_EN_COURS', 'A_VERIFIER'],
  SAISIE_EN_COURS: ['BOUILLON', 'A_VERIFIER'],
  A_VERIFIER: ['SAISIE_EN_COURS', 'VALIDEE'],
  VALIDEE: ['A_VERIFIER', 'PUBLIEE'],
  PUBLIEE: [],
};

/** Statuts d'évaluation dans lesquels la saisie des notes reste possible. */
const SAISIE_AUTORISEE: readonly string[] = ['BOUILLON', 'SAISIE_EN_COURS', 'A_VERIFIER'];

const typeSchema = z.object({
  code: z.string().trim().min(1).max(24),
  name: z.string().trim().min(2).max(60),
  category: z.enum(CATEGORIES),
  defaultOutOf: z.union([z.coerce.number().positive(), z.string()]).optional(),
});

const assessmentSchema = z.object({
  classroomSubjectId: z.string().min(1),
  semesterId: z.string().min(1),
  typeId: z.string().min(1),
  title: z.string().trim().min(2).max(80),
  position: z.number().int().min(1).max(50).optional(),
  outOf: z.union([z.coerce.number().positive(), z.string()]).optional(),
  date: z.coerce.date().optional(),
});

const assessmentUpdateSchema = z.object({
  title: z.string().trim().min(2).max(80).optional(),
  position: z.number().int().min(1).max(50).optional(),
  outOf: z.union([z.coerce.number().positive(), z.string()]).optional(),
  date: z.coerce.date().nullable().optional(),
});

const statutSchema = z.object({ status: z.enum(STATUTS_EVALUATION) });

const notesSchema = z.object({
  assessmentId: z.string().min(1),
  notes: z
    .array(
      z.object({
        enrollmentId: z.string().min(1),
        score: z.union([z.coerce.number(), z.string(), z.null()]).optional(),
        status: z.enum(STATUTS_NOTE),
        observation: z.string().trim().max(200).nullish(),
      })
    )
    .min(1)
    .max(200),
});

// Les notes sont réservées aux comptes d'établissement : l'administrateur plateforme
// n'y a pas accès sans autorisation temporaire (requireSchoolId le refuse).
router.use(requireAuth, requireRole('SCHOOL_ADMIN', 'SURVEILLANT_GENERAL', 'ASSISTANT'));

/** Validation et publication réservées à l'admin d'établissement et au surveillant général. */
async function assertDroitsValidation(req: { currentUser?: { role?: string } | null }): Promise<void> {
  const role = req.currentUser?.role;
  if (role !== 'SCHOOL_ADMIN' && role !== 'SURVEILLANT_GENERAL') {
    throw new HttpError(403, 'Droits insuffisants : valider ou publier une évaluation est réservé à l\'administrateur et au surveillant général');
  }
}

function estDecimalPrisma(valeur: unknown) {
  return valeur === null || valeur === undefined ? null : String(valeur);
}

/**
 * Les saisies françaises acceptent « 12,5 » comme « 12.5 » : la normalisation se fait
 * à la frontière HTTP, le moteur de calcul ne reçoit que des valeurs au point.
 */
function versNombre(valeur: unknown): number | null {
  if (valeur === null || valeur === undefined) return null;
  const texte = String(valeur).trim().replace(/\s/g, '').replace(',', '.');
  if (texte === '') return null;
  const nombre = Number(texte);
  return Number.isFinite(nombre) ? nombre : null;
}

function versDecimalPrisma(valeur: unknown, label: string): Prisma.Decimal {
  const nombre = versNombre(valeur);
  if (nombre === null) {
    throw new HttpError(400, `${label} : valeur numérique invalide`);
  }
  return new Prisma.Decimal(String(nombre));
}

/**
 * @openapi
 * /api/assessment-types:
 *   get:
 *     summary: Types d'évaluation de l'établissement
 *     tags: [Notes et calculs]
 *     responses:
 *       200: { description: Liste des types }
 *   post:
 *     summary: Créer un type d'évaluation (devoir, composition, autre)
 *     tags: [Notes et calculs]
 *     responses:
 *       201: { description: Type créé }
 *       409: { description: Code déjà utilisé dans l'établissement }
 */
router.get('/assessment-types', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const types = await prisma.assessmentType.findMany({
    where: { schoolId, deletedAt: null },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });
  res.json({
    types: types.map((t) => ({ ...t, defaultOutOf: estDecimalPrisma(t.defaultOutOf) })),
  });
}));

router.post('/assessment-types', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const data = typeSchema.parse(req.body);
  const existant = await prisma.assessmentType.findFirst({
    where: { schoolId, code: data.code },
  });
  if (existant) throw new HttpError(409, 'Ce code de type d\'évaluation existe déjà');
  const type = await prisma.assessmentType.create({
    data: {
      schoolId,
      code: data.code,
      name: data.name,
      category: data.category,
      ...(data.defaultOutOf !== undefined
        ? { defaultOutOf: versDecimalPrisma(data.defaultOutOf, 'Barème par défaut') }
        : {}),
    },
  });
  res.status(201).json({ type: { ...type, defaultOutOf: estDecimalPrisma(type.defaultOutOf) } });
}));

/**
 * @openapi
 * /api/assessments:
 *   get:
 *     summary: Lister les évaluations de l'établissement
 *     tags: [Notes et calculs]
 *     parameters:
 *       - in: query
 *         name: classroomSubjectId
 *         schema: { type: string }
 *       - in: query
 *         name: semesterId
 *         schema: { type: string }
 *     responses:
 *       200: { description: Évaluations avec statut et nombre de notes saisies }
 *   post:
 *     summary: Créer une évaluation (brouillon) sur une discipline de classe
 *     tags: [Notes et calculs]
 *     responses:
 *       201: { description: Évaluation créée, position auto si non fournie }
 *       404: { description: Discipline, semestre ou type hors de l'établissement }
 *       409: { description: Doublon classe/semestre/type/position ou année clôturée }
 */
router.get('/assessments', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const classroomSubjectId = typeof req.query.classroomSubjectId === 'string' ? req.query.classroomSubjectId : undefined;
  const semesterId = typeof req.query.semesterId === 'string' ? req.query.semesterId : undefined;

  const assessments = await prisma.assessment.findMany({
    where: {
      schoolId,
      deletedAt: null,
      ...(classroomSubjectId ? { classroomSubjectId } : {}),
      ...(semesterId ? { semesterId } : {}),
    },
    include: {
      type: true,
      classroomSubject: { include: { subject: true, classroom: true } },
      semester: true,
      _count: { select: { grades: { where: { deletedAt: null } } } },
    },
    orderBy: [{ semesterId: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
  });

  res.json({
    assessments: assessments.map((a) => ({
      id: a.id,
      title: a.title,
      position: a.position,
      status: a.status,
      outOf: estDecimalPrisma(a.outOf),
      date: a.date,
      validatedAt: a.validatedAt,
      publishedAt: a.publishedAt,
      classroomId: a.classroomSubject.classroomId,
      classroomName: a.classroomSubject.classroom.name,
      subjectId: a.classroomSubject.subjectId,
      subjectName: a.classroomSubject.subject.name,
      semesterId: a.semesterId,
      semesterName: a.semester.name,
      typeId: a.typeId,
      typeName: a.type.name,
      category: a.type.category,
      notesSaisies: a._count.grades,
    })),
  });
}));

router.post('/assessments', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const data = assessmentSchema.parse(req.body);

  const [classroomSubject, semester, type] = await Promise.all([
    prisma.classroomSubject.findFirst({
      where: { id: data.classroomSubjectId, schoolId },
      include: { classroom: true },
    }),
    prisma.semester.findFirst({
      where: { id: data.semesterId, academicYear: { schoolId, deletedAt: null } },
      include: { academicYear: true },
    }),
    prisma.assessmentType.findFirst({
      where: { id: data.typeId, schoolId, deletedAt: null, actif: true },
    }),
  ]);

  if (!classroomSubject) throw new HttpError(404, 'Discipline de classe introuvable');
  if (!semester) throw new HttpError(404, 'Semestre introuvable pour cet établissement');
  if (!type) throw new HttpError(404, 'Type d\'évaluation introuvable ou inactif');
  if (semester.academicYear.status === 'CLOSED') {
    throw new HttpError(409, "L'année scolaire est clôturée");
  }

  const position = data.position ?? ((await prisma.assessment.count({
    where: {
      schoolId,
      classroomSubjectId: classroomSubject.id,
      semesterId: semester.id,
      typeId: type.id,
    },
  })) + 1);

  const outOf = data.outOf ?? estDecimalPrisma(type.defaultOutOf) ?? '20';

  try {
    const assessment = await prisma.assessment.create({
      data: {
        schoolId,
        classroomSubjectId: classroomSubject.id,
        semesterId: semester.id,
        typeId: type.id,
        title: data.title,
        position,
        outOf: versDecimalPrisma(outOf, 'Barème'),
        ...(data.date ? { date: data.date } : {}),
      },
      include: { type: true },
    });
    await writeAuditLog({
      req,
      schoolId,
      userId: req.currentUser!.id,
      action: 'ASSESSMENT_CREATED',
      entityType: 'Assessment',
      entityId: assessment.id,
      metadata: { classroomId: classroomSubject.classroomId, subjectId: classroomSubject.subjectId, semesterId: semester.id, typeId: type.id },
    });
    res.status(201).json({
      assessment: {
        ...assessment,
        outOf: estDecimalPrisma(assessment.outOf),
        defaultOutOf: estDecimalPrisma(assessment.type.defaultOutOf),
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      throw new HttpError(409, 'Cette évaluation existe déjà pour cette classe, ce semestre et ce type (doublon)');
    }
    throw error;
  }
}));

async function chargerEvaluation(schoolId: string, id: string) {
  const assessment = await prisma.assessment.findFirst({
    where: { id, schoolId, deletedAt: null },
    include: { classroomSubject: true, type: true },
  });
  if (!assessment) throw new HttpError(404, 'Évaluation introuvable pour cet établissement');
  return assessment;
}

/**
 * @openapi
 * /api/assessments/{id}:
 *   patch:
 *     summary: Corriger le titre, la position, le barème ou la date d'une évaluation
 *     tags: [Notes et calculs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Évaluation mise à jour }
 *       404: { description: Évaluation hors de l'établissement }
 *       409: { description: Évaluation validée ou publiée, repasser en « à vérifier » }
 *   delete:
 *     summary: Suppression logique d'une évaluation non publiée
 *     tags: [Notes et calculs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204: { description: Évaluation supprimée }
 *       409: { description: Une évaluation publiée ne se supprime pas }
 * /api/assessments/{id}/statut:
 *   post:
 *     summary: Transition du workflow (brouillon → saisie → à vérifier → validée → publiée)
 *     tags: [Notes et calculs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Nouveau statut }
 *       403: { description: Validation réservée à l'administrateur et au surveillant général }
 *       409: { description: Transition interdite }
 *       422: { description: Saisie incomplète, validation impossible }
 */
router.patch('/assessments/:id', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const assessment = await chargerEvaluation(schoolId, req.params.id);
  if (assessment.status === 'PUBLIEE') {
    throw new HttpError(409, 'Évaluation publiée : une correction passe par une nouvelle version autorisée et tracée');
  }
  if (assessment.status === 'VALIDEE') {
    throw new HttpError(409, 'Évaluation validée : repasser en « à vérifier » avant modification');
  }
  const data = assessmentUpdateSchema.parse(req.body);
  const updated = await prisma.assessment.update({
    where: { id: assessment.id },
    data: {
      ...(data.title ? { title: data.title } : {}),
      ...(data.position ? { position: data.position } : {}),
      ...(data.date !== undefined ? { date: data.date } : {}),
      ...(data.outOf !== undefined ? { outOf: versDecimalPrisma(data.outOf, 'Barème') } : {}),
    },
  });
  await writeAuditLog({
    req,
    schoolId,
    userId: req.currentUser!.id,
    action: 'ASSESSMENT_UPDATED',
    entityType: 'Assessment',
    entityId: updated.id,
    metadata: { champs: Object.keys(data) },
  });
  res.json({ assessment: { ...updated, outOf: estDecimalPrisma(updated.outOf) } });
}));

router.post('/assessments/:id/statut', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const { status } = statutSchema.parse(req.body);
  const assessment = await chargerEvaluation(schoolId, req.params.id);

  if (status === 'VALIDEE' || status === 'PUBLIEE' || assessment.status === 'VALIDEE' || assessment.status === 'PUBLIEE') {
    await assertDroitsValidation(req);
  }

  if (!TRANSITIONS[assessment.status].includes(status)) {
    throw new HttpError(
      409,
      `Transition interdite : ${assessment.status} → ${status}. Transitions possibles : ${TRANSITIONS[assessment.status].join(', ') || 'aucune (évaluation figée)'}`
    );
  }

  if (status === 'VALIDEE' || status === 'PUBLIEE') {
    const [effectif, saisies] = await Promise.all([
      prisma.enrollment.count({
        where: { schoolId, classroomId: assessment.classroomSubject.classroomId, status: 'ACTIVE', deletedAt: null },
      }),
      prisma.grade.count({
        where: {
          schoolId,
          assessmentId: assessment.id,
          deletedAt: null,
          status: { not: 'NON_SAISIE' },
        },
      }),
    ]);
    if (saisies < effectif) {
      throw new HttpError(
        422,
        `Saisie incomplète : ${effectif - saisies} élève(s) sans note. Validation impossible.`
      );
    }
  }

  const now = new Date();
  const updated = await prisma.assessment.update({
    where: { id: assessment.id },
    data: {
      status,
      ...(status === 'VALIDEE' ? { validatedAt: now } : {}),
      ...(status === 'PUBLIEE' ? { publishedAt: now, validatedAt: assessment.validatedAt ?? now } : {}),
    },
  });
  await writeAuditLog({
    req,
    schoolId,
    userId: req.currentUser!.id,
    action: 'ASSESSMENT_STATUS_CHANGED',
    entityType: 'Assessment',
    entityId: updated.id,
    metadata: { de: assessment.status, vers: status },
  });
  res.json({ assessment: { ...updated, outOf: estDecimalPrisma(updated.outOf) } });
}));

router.delete('/assessments/:id', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const assessment = await chargerEvaluation(schoolId, req.params.id);
  if (assessment.status === 'PUBLIEE') {
    throw new HttpError(409, 'Une évaluation publiée ne se supprime pas : elle alimente des bulletins');
  }
  await prisma.assessment.update({ where: { id: assessment.id }, data: { deletedAt: new Date() } });
  await writeAuditLog({
    req,
    schoolId,
    userId: req.currentUser!.id,
    action: 'ASSESSMENT_DELETED',
    entityType: 'Assessment',
    entityId: assessment.id,
  });
  res.status(204).end();
}));

/**
 * @openapi
 * /api/grade-grid:
 *   get:
 *     summary: Grille de saisie, une ligne par élève actif de la classe
 *     tags: [Notes et calculs]
 *     parameters:
 *       - in: query
 *         name: assessmentId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Lignes avec note, statut et indicateur de saisie autorisée }
 *       400: { description: assessmentId manquant }
 *       404: { description: Évaluation hors de l'établissement }
 * /api/grades:
 *   put:
 *     summary: Enregistrement explicite d'une grille de notes (tout ou rien)
 *     tags: [Notes et calculs]
 *     description: >
 *       Un score n'est accepté qu'avec le statut SAISIE et dans le barème de
 *       l'évaluation. Toute erreur refuse la grille sans rien écrire.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               assessmentId: { type: string }
 *               notes:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     enrollmentId: { type: string }
 *                     score: { type: string, nullable: true }
 *                     status: { type: string, enum: [SAISIE, ABSENT, ANNULEE, NON_SAISIE] }
 *                     observation: { type: string, nullable: true }
 *     responses:
 *       200: { description: Notes enregistrées, avec indicateur pour l'interface }
 *       400: { description: Élève hors de la classe }
 *       409: { description: Saisie fermée par le statut de l'évaluation }
 *       422: { description: Erreurs par ligne, aucune donnée écrite }
 */
router.get('/grade-grid', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const assessmentId = typeof req.query.assessmentId === 'string' ? req.query.assessmentId : '';
  if (!assessmentId) throw new HttpError(400, 'Paramètre assessmentId requis');

  const assessment = await chargerEvaluation(schoolId, assessmentId);
  const classroomId = assessment.classroomSubject.classroomId;

  const [enrollments, grades] = await Promise.all([
    prisma.enrollment.findMany({
      where: { schoolId, classroomId, status: 'ACTIVE', deletedAt: null },
      include: { student: true },
      orderBy: [{ student: { lastName: 'asc' } }, { student: { firstNames: 'asc' } }],
    }),
    prisma.grade.findMany({
      where: { schoolId, assessmentId, deletedAt: null },
    }),
  ]);

  const parEleve = new Map(grades.map((g) => [g.enrollmentId, g]));

  res.json({
    assessment: {
      id: assessment.id,
      title: assessment.title,
      status: assessment.status,
      outOf: estDecimalPrisma(assessment.outOf),
      saisieAutorisee: SAISIE_AUTORISEE.includes(assessment.status),
    },
    lignes: enrollments.map((e) => {
      const grade = parEleve.get(e.id);
      return {
        enrollmentId: e.id,
        studentId: e.student.id,
        matricule: e.student.matricule,
        nom: e.student.lastName,
        prenoms: e.student.firstNames,
        gradeId: grade?.id ?? null,
        score: grade ? estDecimalPrisma(grade.score) : null,
        status: grade?.status ?? 'NON_SAISIE',
        observation: grade?.observation ?? null,
      };
    }),
  });
}));

/**
 * Enregistrement d'une grille de notes (sauvegarde explicite, upsert par élève).
 * Règles serveur : un score n'est accepté que si status = SAISIE, il doit être dans le barème,
 * et l'élève doit appartenir à la classe de l'évaluation et à l'établissement.
 */
router.put('/grades', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const { assessmentId, notes } = notesSchema.parse(req.body);

  const assessment = await chargerEvaluation(schoolId, assessmentId);
  if (!SAISIE_AUTORISEE.includes(assessment.status)) {
    throw new HttpError(409, `Saisie fermée : évaluation au statut ${assessment.status}`);
  }

  const bar = versNombre(estDecimalPrisma(assessment.outOf));
  if (bar === null || !(bar > 0)) throw new HttpError(500, 'Barème de l\'évaluation invalide');

  const enrollmentIds = notes.map((n) => n.enrollmentId);
  const valides = await prisma.enrollment.count({
    where: {
      id: { in: enrollmentIds },
      schoolId,
      classroomId: assessment.classroomSubject.classroomId,
      deletedAt: null,
    },
  });
  if (valides !== enrollmentIds.length) {
    throw new HttpError(400, 'Un ou plusieurs élèves n\'appartiennent pas à cette classe');
  }

  const erreurs: { enrollmentId: string; message: string }[] = [];
  const prepares: {
    enrollmentId: string;
    score: string | null;
    status: (typeof STATUTS_NOTE)[number];
    observation: string | null;
  }[] = [];

  for (const note of notes) {
    if (note.status === 'SAISIE') {
      const valeur = versNombre(note.score);
      if (valeur === null || !Number.isFinite(valeur)) {
        erreurs.push({ enrollmentId: note.enrollmentId, message: 'Note de saisie sans score' });
        continue;
      }
      if (valeur < 0 || valeur > bar) {
        erreurs.push({ enrollmentId: note.enrollmentId, message: `Note hors barème (0 → ${bar})` });
        continue;
      }
      prepares.push({
        enrollmentId: note.enrollmentId,
        score: String(valeur),
        status: 'SAISIE',
        observation: note.observation ?? null,
      });
      continue;
    }
    // ABSENT / ANNULEE / NON_SAISIE : aucun score n'est accepté, un 0 ne vaut pas absence.
    if (note.score !== null && note.score !== undefined && note.score !== '') {
      erreurs.push({
        enrollmentId: note.enrollmentId,
        message: `Un score n'est pas autorisé avec le statut ${note.status}`,
      });
      continue;
    }
    prepares.push({
      enrollmentId: note.enrollmentId,
      score: null,
      status: note.status,
      observation: note.observation ?? null,
    });
  }

  if (erreurs.length > 0) {
    // Aucune perte de données : rien n'est écrit tant que la grille contient une erreur.
    throw new HttpError(422, 'Saisie refusée : corrigez les erreurs signalées', { erreurs });
  }

  const enregistre = await prisma.$transaction(
    prepares.map((n) =>
      prisma.grade.upsert({
        where: { assessmentId_enrollmentId: { assessmentId, enrollmentId: n.enrollmentId } },
        create: {
          schoolId,
          assessmentId,
          enrollmentId: n.enrollmentId,
          score: n.score === null ? null : new Prisma.Decimal(n.score),
          status: n.status,
          observation: n.observation,
        },
        update: {
          score: n.score === null ? null : new Prisma.Decimal(n.score),
          status: n.status,
          observation: n.observation,
          deletedAt: null,
        },
      })
    )
  );

  await writeAuditLog({
    req,
    schoolId,
    userId: req.currentUser!.id,
    action: 'GRADES_SAVED',
    entityType: 'Assessment',
    entityId: assessmentId,
    metadata: { nombre: enregistre.length, statutEvaluation: assessment.status },
  });

  res.json({
    enregistrees: enregistre.length,
    evaluation: { id: assessment.id, status: assessment.status },
    indicateur: `${enregistre.length} note(s) enregistrée(s) sur ${assessment.title}`,
  });
}));

/**
 * @openapi
 * /api/calculations:
 *   get:
 *     summary: Moyennes, points pondérés et rangs d'une classe (calcul 100 % serveur)
 *     tags: [Notes et calculs]
 *     parameters:
 *       - in: query
 *         name: classroomId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: semesterId
 *         schema: { type: string }
 *       - in: query
 *         name: inclureBrouillons
 *         schema: { type: boolean, default: false }
 *         description: Prévisualisation ; le calcul officiel ignore les évaluations non validées
 *     responses:
 *       200: { description: Résultats par élève et par matière, valeur exacte et valeur affichée }
 *       404: { description: Classe hors de l'établissement }
 *       422: { description: Classe sans élève actif ou sans discipline }
 * /api/calculations/annual:
 *   get:
 *     summary: Bilan annuel d'une classe (S1, S2 et moyenne annuelle)
 *     tags: [Notes et calculs]
 *     parameters:
 *       - in: query
 *         name: classroomId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: academicYearId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Annuelle calculable seulement si les deux semestres le sont }
 *       422: { description: Année scolaire sans ses deux semestres }
 */
router.get('/calculations', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const classroomId = typeof req.query.classroomId === 'string' ? req.query.classroomId : '';
  const semesterId = typeof req.query.semesterId === 'string' ? req.query.semesterId : null;
  const inclureBrouillons = req.query.inclureBrouillons === 'true';
  if (!classroomId) throw new HttpError(400, 'Paramètre classroomId requis');

  const school = await prisma.school.findFirst({ where: { id: schoolId, deletedAt: null } });
  if (!school) throw new HttpError(404, 'Établissement introuvable');
  const params = parametresEtablissement(school);

  const resultats = await calculerResultatsClasse({
    schoolId,
    classroomId,
    semesterId,
    inclureBrouillons,
  });

  res.json({
    classroomId: resultats.classroomId,
    semesterId: resultats.semesterId,
    effectif: resultats.effectif,
    moyenneClasse: formaterNote(resultats.moyenneClasse, params.decimalsAffichage, params.arrondi),
    moyenneClasseExacte: resultats.moyenneClasse?.toString() ?? null,
    motifs: resultats.motifs,
    eleves: resultats.eleves.map((e) => ({
      enrollmentId: e.enrollmentId,
      studentId: e.studentId,
      matricule: e.matricule,
      nom: e.nom,
      prenoms: e.prenoms,
      moyenneGenerale: formaterNote(e.moyenneGenerale, params.decimalsAffichage, params.arrondi),
      moyenneGeneraleExacte: e.moyenneGenerale?.toString() ?? null,
      totalPoints: e.totalPoints.toString(),
      totalCoeficients: e.totalCoeficients.toString(),
      rang: e.rang,
      motifNonClasse: e.motifNonClasse,
      incomplet: e.incomplet,
      matieres: e.matieres.map((m) => ({
        subjectId: m.subjectId,
        subjectName: m.subjectName,
        coefficient: m.coefficient?.toString() ?? null,
        moyenne: formaterNote(m.moyenne, params.decimalsAffichage, params.arrondi),
        moyenneExacte: m.moyenne?.toString() ?? null,
        pointsPonderes: m.pointsPonderes?.toString() ?? null,
        comptabilisee: m.comptabilisee,
        incomplet: m.incomplet,
        motifs: m.motifs,
      })),
    })),
  });
}));

/** Bilan annuel (S1 + S2) d'une classe, selon la formule de l'établissement. */
router.get('/calculations/annual', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const classroomId = typeof req.query.classroomId === 'string' ? req.query.classroomId : '';
  const academicYearId = typeof req.query.academicYearId === 'string' ? req.query.academicYearId : '';
  if (!classroomId || !academicYearId) {
    throw new HttpError(400, 'Paramètres classroomId et academicYearId requis');
  }

  const bilan = await calculerBilanAnnuel({ schoolId, classroomId, academicYearId });
  res.json({
    effectif: bilan.effectif,
    eleves: bilan.eleves.map((e) => ({
      enrollmentId: e.enrollmentId,
      matricule: e.matricule,
      nom: e.nom,
      prenoms: e.prenoms,
      s1: e.s1?.toString() ?? null,
      s2: e.s2?.toString() ?? null,
      annuelle: e.affichage,
      annuelleExacte: e.annuelle?.toString() ?? null,
      calculable: e.calculable,
      partiel: e.partiel,
      motifs: e.motifs,
    })),
  });
}));

export const gradesRouter = router;
