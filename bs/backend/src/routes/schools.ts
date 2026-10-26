import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { asyncHandler, HttpError } from '../lib/http';
import { publicSchool } from '../lib/serializers';
import { requireAuth, requireRole } from '../middleware/auth';
import { requireSchoolScope } from '../middleware/school-scope';
import { writeAuditLog } from '../services/audit';
import { requireCsrf } from '../lib/csrf';

const router = Router();

/** Poids et barèmes : Decimal(5,2) en base, bornés pour rester enregistrables. */
const poids = z.number().min(0).max(999.99);

/**
 * Règles de calcul de l'établissement. Les valeurs autorisées sont exactement celles
 * comprises par le moteur de calcul (`services/calcul/etablissement.ts`) : une valeur
 * hors liste est refusée plutôt que silencieusement remplacée par le défaut.
 */
const schoolRulesSchema = z.object({
  regleCalculMatiere: z.enum(['POIDS_GROUPES', 'MOYENNE_TOUTES_NOTES']),
  poidsDevoirs: poids,
  poidsCompositions: poids,
  poidsAutres: poids,
  absencesComptentZero: z.boolean(),
  groupeSansNote: z.enum(['EXCLURE', 'BLOQUANT']),
  coefficientInvalide: z.enum(['EXCLURE', 'ERREUR']),
  baremeParDefaut: z.number().gt(0).max(999.99),
  arrondiDecimales: z.number().int().min(0).max(4),
  arrondiMode: z.enum(['HALF_UP', 'HALF_EVEN']),
  rangMode: z.enum(['STANDARD', 'DENSE']),
  classerResultatsIncomplets: z.boolean(),
  poidsSemestre1: poids,
  poidsSemestre2: poids,
  annuelSiSemestreManquant: z.enum(['NULL', 'PARTIEL']),
});

const schoolSchema = z
  .object({
    name: z.string().trim().min(2, 'Nom trop court'),
    officialName: z.string().trim().min(2).optional(),
    city: z.string().trim().optional(),
    address: z.string().trim().optional(),
    phone: z.string().trim().optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    accreditationNumber: z.string().trim().optional(),
    isActive: z.boolean().optional(),
  })
  .merge(schoolRulesSchema.partial());

router.use(requireAuth);

router.get(
  '/',
  requireRole('PLATFORM_ADMIN'),
  asyncHandler(async (_req, res) => {
    const schools = await prisma.school.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
    });
    res.json({ schools: schools.map(publicSchool) });
  }),
);

router.get(
  '/mine',
  requireRole('SCHOOL_ADMIN', 'SURVEILLANT_GENERAL', 'ASSISTANT'),
  asyncHandler(async (req, res) => {
    const schoolId = req.currentUser!.schoolId;
    if (!schoolId) {
      throw new HttpError(404, 'Aucun établissement trouvé');
    }
    const school = await prisma.school.findFirst({
      where: { id: schoolId, deletedAt: null },
    });
    if (!school) {
      throw new HttpError(404, 'Établissement introuvable');
    }
    res.json({ school: publicSchool(school) });
  }),
);

router.post(
  '/',
  requireRole('PLATFORM_ADMIN'),
  requireCsrf,
  asyncHandler(async (req, res) => {
    const data = schoolSchema.parse(req.body);
    const school = await prisma.school.create({ data });
    await writeAuditLog({
      req,
      userId: req.currentUser!.id,
      action: 'SCHOOL_CREATED',
      entityType: 'School',
      entityId: school.id,
    });
    res.status(201).json({ school: publicSchool(school) });
  }),
);

router.get(
  '/:schoolId',
  requireSchoolScope,
  requireRole('PLATFORM_ADMIN', 'SCHOOL_ADMIN', 'SURVEILLANT_GENERAL', 'ASSISTANT'),
  asyncHandler(async (req, res) => {
    const id = req.schoolScopeId!;
    const school = await prisma.school.findFirst({
      where: { id, deletedAt: null },
    });
    if (!school) {
      throw new HttpError(404, 'Établissement introuvable');
    }
    res.json({ school: publicSchool(school) });
  }),
);

router.patch(
  '/:schoolId',
  requireSchoolScope,
  requireRole('PLATFORM_ADMIN', 'SCHOOL_ADMIN'),
  requireCsrf,
  asyncHandler(async (req, res) => {
    const actor = req.currentUser!;
    const data = schoolSchema.partial().parse(req.body);
    const id = req.schoolScopeId;

    if (!id) {
      throw new HttpError(400, 'Identifiant établissement requis');
    }

    if (actor.role === 'SCHOOL_ADMIN') {
      if ('isActive' in data) {
        data.isActive = undefined;
      }
    }

    const school = await prisma.school.update({ where: { id }, data });
    await writeAuditLog({
      req,
      schoolId: school.id,
      userId: actor.id,
      action: 'SCHOOL_UPDATED',
      entityType: 'School',
      entityId: school.id,
    });
    res.json({ school: publicSchool(school) });
  }),
);

router.delete(
  '/:schoolId',
  requireRole('PLATFORM_ADMIN'),
  requireCsrf,
  asyncHandler(async (req, res) => {
    const { schoolId: id } = req.params;
    await prisma.school.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await writeAuditLog({
      req,
      userId: req.currentUser!.id,
      action: 'SCHOOL_DELETED',
      entityType: 'School',
      entityId: id,
    });
    res.status(204).end();
  }),
);

export const schoolsRouter = router;
