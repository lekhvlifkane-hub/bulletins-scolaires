import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { asyncHandler, HttpError } from '../lib/http';
import { hashPassword } from '../lib/password';
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
    adminName: z.string().trim().min(2).optional(),
    adminEmail: z.string().trim().toLowerCase().email().optional(),
    adminPassword: z.string().min(6).optional(),
  })
  .merge(schoolRulesSchema.partial());

const schoolRegisterSchema = z.object({
  schoolName: z.string().trim().min(2, "Nom de l'établissement trop court"),
  city: z.string().trim().min(1, 'Ville requise'),
  phone: z.string().trim().min(1, 'Téléphone requis'),
  adminName: z.string().trim().min(2, "Nom de l'administrateur trop court"),
  adminEmail: z.string().trim().toLowerCase().email('Adresse e-mail invalide'),
  // Même politique de mot de passe que le reste de l'application (voir auth.ts) :
  // un administrateur d'établissement n'a pas de règle plus faible que les autres.
  password: z
    .string()
    .min(12, 'Le mot de passe doit contenir au moins 12 caractères')
    .max(128, 'Le mot de passe ne peut pas dépasser 128 caractères')
    .regex(/[A-Za-z]/, 'Le mot de passe doit contenir au moins une lettre')
    .regex(/[0-9]/, 'Le mot de passe doit contenir au moins un chiffre'),
});

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const data = schoolRegisterSchema.parse(req.body);
    const existingUser = await prisma.user.findUnique({ where: { email: data.adminEmail } });
    if (existingUser) {
      throw new HttpError(409, 'Cet e-mail est déjà utilisé');
    }
    // Hachage scrypt, identique au reste de l'application : `verifyPassword` ne
    // sait vérifier que ce format. Un autre algorithme rendrait le compte
    // administrateur définitivement inaccessible après approbation.
    const passwordHash = await hashPassword(data.password);
    const result = await prisma.$transaction(async (tx) => {
      const school = await tx.school.create({
        data: {
          name: data.schoolName,
          city: data.city,
          phone: data.phone,
          status: 'PENDING',
          isActive: false,
        },
      });
      const user = await tx.user.create({
        data: {
          schoolId: school.id,
          name: data.adminName,
          email: data.adminEmail,
          passwordHash,
          role: 'SCHOOL_ADMIN',
          isActive: false,
        },
      });
      return { school, user };
    });
    await writeAuditLog({
      req,
      schoolId: result.school.id,
      userId: result.user.id,
      action: 'SCHOOL_REGISTERED',
      entityType: 'School',
      entityId: result.school.id,
    });
    res.status(201).json({ message: "Demande d'inscription envoyée" });
  }),
);

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
  '/pending',
  requireRole('PLATFORM_ADMIN'),
  asyncHandler(async (_req, res) => {
    const schools = await prisma.school.findMany({
      where: { deletedAt: null, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
    const result = await Promise.all(
      schools.map(async (school) => {
        const admin = await prisma.user.findFirst({
          where: { schoolId: school.id, role: 'SCHOOL_ADMIN', deletedAt: null },
          select: { id: true, name: true, email: true },
        });
        return { ...publicSchool(school), admin };
      }),
    );
    res.json({ schools: result });
  }),
);

router.post(
  '/:schoolId/approve',
  requireRole('PLATFORM_ADMIN'),
  requireCsrf,
  asyncHandler(async (req, res) => {
    const { schoolId } = req.params;
    const school = await prisma.school.findFirst({ where: { id: schoolId, deletedAt: null } });
    if (!school) throw new HttpError(404, 'Établissement introuvable');
    await prisma.$transaction(async (tx) => {
      await tx.school.update({
        where: { id: schoolId },
        data: { status: 'ACTIVE', isActive: true },
      });
      await tx.user.updateMany({
        where: { schoolId, role: 'SCHOOL_ADMIN', deletedAt: null },
        data: { isActive: true },
      });
    });
    await writeAuditLog({
      req,
      userId: req.currentUser!.id,
      action: 'SCHOOL_APPROVED',
      entityType: 'School',
      entityId: schoolId,
    });
    res.json({ message: 'Établissement approuvé' });
  }),
);

router.post(
  '/:schoolId/reject',
  requireRole('PLATFORM_ADMIN'),
  requireCsrf,
  asyncHandler(async (req, res) => {
    const { schoolId } = req.params;
    const schema = z.object({ reason: z.string().trim().optional() });
    const { reason } = schema.parse(req.body);
    const school = await prisma.school.findFirst({ where: { id: schoolId, deletedAt: null } });
    if (!school) throw new HttpError(404, 'Établissement introuvable');
    await prisma.school.update({
      where: { id: schoolId },
      data: { status: 'REJECTED', isActive: false },
    });
    await writeAuditLog({
      req,
      userId: req.currentUser!.id,
      action: 'SCHOOL_REJECTED',
      entityType: 'School',
      entityId: schoolId,
      metadata: { reason },
    });
    res.json({ message: 'Établissement refusé' });
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
    const { adminName, adminEmail, adminPassword, ...schoolData } = data as any;

    const result = await prisma.$transaction(async (tx) => {
      const school = await tx.school.create({
        data: {
          ...schoolData,
          status: 'ACTIVE',
          isActive: true,
        },
      });

      let admin = null;
      if (adminName && adminEmail && adminPassword) {
        const existingUser = await tx.user.findUnique({ where: { email: adminEmail } });
        if (existingUser) {
          throw new HttpError(409, 'Cet e-mail est déjà utilisé');
        }
        const passwordHash = await hashPassword(adminPassword);
        admin = await tx.user.create({
          data: {
            schoolId: school.id,
            name: adminName,
            email: adminEmail,
            passwordHash,
            role: 'SCHOOL_ADMIN',
            isActive: true,
          },
        });
      }

      return { school, admin };
    });

    await writeAuditLog({
      req,
      userId: req.currentUser!.id,
      action: 'SCHOOL_CREATED',
      entityType: 'School',
      entityId: result.school.id,
    });
    res.status(201).json({ school: publicSchool(result.school), admin: result.admin ? { id: result.admin.id, name: result.admin.name, email: result.admin.email } : null });
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
