import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import type { AnnualSummary, ReportCard } from '@prisma/client';
import { prisma } from '../db/prisma';
import { asyncHandler, HttpError } from '../lib/http';
import { requireCsrf } from '../lib/csrf';
import { requireAuth, requireRole, requireSchoolId } from '../middleware/auth';
import { writeAuditLog } from '../services/audit';
import {
  corrigerBulletin,
  genererBulletin,
  genererBulletinsClasse,
  historiqueVersions,
  lireSnapshot,
  modifierChampsLibres,
  publierBulletins,
} from '../services/bulletins/bulletin';
import { genererBilanAnnuel, publierBilansAnnuels } from '../services/bulletins/annual';
import { comparerSemestres } from '../services/bulletins/comparaison';
import {
  genererPdfBilanAnnuel,
  genererPdfBilansAnnuels,
  genererPdfBulletin,
  genererPdfBulletins,
  type BilanPourPdf,
  type BulletinPourPdf,
  type MetaBulletin,
} from '../services/bulletins/pdf';
import type { SnapshotBilanAnnuel } from '../services/bulletins/types';

/**
 * Bulletins et bilans annuels (phase 5).
 *
 * Le serveur est la seule autorité : génération, publication, correction, comparaison et
 * PDF partent tous du snapshot figé. L'interface n'additionne jamais deux moyennes.
 * Publication et correction sont réservées à l'administrateur et au surveillant général ;
 * la lecture est ouverte aux trois rôles d'établissement habilités.
 */

const router = Router();

const MAX_PAR_LOT = 60;

const genererSchema = z.object({
  enrollmentId: z.string().min(1),
  semesterId: z.string().min(1),
});

const genererClasseSchema = z.object({
  classroomId: z.string().min(1),
  semesterId: z.string().min(1),
});

const idsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
});

const corrigerSchema = z.object({
  motif: z.string().trim().min(3).max(300),
});

const champsLibresSchema = z
  .object({
    mention: z.string().trim().max(120).nullish(),
    appreciation: z.string().trim().max(500).nullish(),
    appreciationsParMatiere: z
      .array(z.object({ subjectId: z.string().min(1), appreciation: z.string().trim().max(300).nullish() }))
      .max(60)
      .optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.mention !== undefined ||
      v.appreciation !== undefined ||
      v.appreciationsParMatiere !== undefined,
    { message: 'Aucun champ à modifier' }
  );

const champsBilanSchema = z
  .object({
    mention: z.string().trim().max(120).nullish(),
    appreciation: z.string().trim().max(500).nullish(),
  })
  .strict()
  .refine((value) => value.mention !== undefined || value.appreciation !== undefined, {
    message: 'Aucun champ à modifier',
  });

const bilanSchema = z.object({
  enrollmentId: z.string().min(1),
  academicYearId: z.string().min(1),
});

router.use(requireAuth, requireRole('SCHOOL_ADMIN', 'SURVEILLANT_GENERAL', 'ASSISTANT'));

/** Écrire un bulletin (générer, publier, corriger) n'est pas laissé à tous les rôles. */
async function assertDroitsBulletin(req: { currentUser?: { role?: string } | null }): Promise<void> {
  const role = req.currentUser?.role;
  if (role !== 'SCHOOL_ADMIN' && role !== 'SURVEILLANT_GENERAL') {
    throw new HttpError(
      403,
      "Droits insuffisants : générer, publier ou corriger un bulletin est réservé à l'administrateur et au surveillant général"
    );
  }
}

function texte(valeur: unknown): string | null {
  if (valeur === null || valeur === undefined) return null;
  return String(valeur);
}

/**
 * Les Decimal quittent l'API en chaînes exactes : jamais de flottant JSON.
 * Les champs `*Affichee` reprennent l'arrondi de l'établissement tel qu'il a été figé dans
 * le snapshot au moment de la génération : c'est lui que l'interface affiche, la valeur
 * exacte restant disponible en infobulle (`moyenneGeneraleExacte`).
 */
function resumeBulletin(card: ReportCard) {
  const snapshot = lireSnapshot(card);
  const synthese = snapshot.synthese;
  return {
    id: card.id,
    enrollmentId: card.enrollmentId,
    semesterId: card.semesterId,
    academicYearId: card.academicYearId,
    version: card.version,
    statut: card.statut,
    estCourant: card.estCourant,
    motifCorrection: card.motifCorrection,
    remplaceReportCardId: card.remplaceReportCardId,
    moyenneGenerale: texte(card.moyenneGenerale),
    moyenneGeneraleAffichee: synthese?.moyenneGeneraleAffichee ?? null,
    moyenneGeneraleExacte: card.moyenneGeneraleExacte,
    moyenneClasse: texte(card.moyenneClasse),
    moyenneClasseAffichee: synthese?.moyenneClasseAffichee ?? null,
    effectif: card.effectif,
    rang: card.rang,
    motifNonClasse: card.motifNonClasse,
    totalPoints: texte(card.totalPoints),
    totalCoeficients: texte(card.totalCoeficients),
    incomplet: card.incomplet,
    motifs: card.motifs,
    absences: snapshot.absences ?? null,
    mention: card.mention,
    decisionConseil: null,
    appreciation: card.appreciation,
    genereLe: card.genereLe?.toISOString() ?? null,
    valideLe: card.valideLe?.toISOString() ?? null,
    publieLe: card.publieLe?.toISOString() ?? null,
  };
}

/**
 * Même convention que resumeBulletin : les colonnes de synthèse gardent la valeur exacte,
 * les champs `*Affichee` reprennent l'arrondi figé dans le snapshot du bilan.
 */
function resumeBilan(bilan: AnnualSummary) {
  const snapshot = bilan.snapshot as unknown as SnapshotBilanAnnuel | null;
  return {
    id: bilan.id,
    enrollmentId: bilan.enrollmentId,
    academicYearId: bilan.academicYearId,
    version: bilan.version,
    statut: bilan.statut,
    estCourant: bilan.estCourant,
    s1ReportCardId: bilan.s1ReportCardId,
    s2ReportCardId: bilan.s2ReportCardId,
    moyenneS1: texte(bilan.moyenneS1),
    moyenneS1Affichee: snapshot?.semestres?.[0]?.moyenneGeneraleAffichee ?? null,
    moyenneS2: texte(bilan.moyenneS2),
    moyenneS2Affichee: snapshot?.semestres?.[1]?.moyenneGeneraleAffichee ?? null,
    moyenneAnnuelle: texte(bilan.moyenneAnnuelle),
    moyenneAnnuelleAffichee: snapshot?.annuelle?.moyenneAffichee ?? null,
    moyenneAnnuelleExacte: bilan.moyenneAnnuelleExacte,
    calculable: bilan.calculable,
    partiel: bilan.partiel,
    rangAnnuel: bilan.rangAnnuel,
    effectif: bilan.effectif,
    motifs: bilan.motifs,
    absences: snapshot?.absences ?? null,
    mention: bilan.mention,
    decisionConseil: snapshot?.decisionConseil ?? null,
    decisionConseilValideeLe: snapshot?.decisionConseilValideeLe ?? null,
    appreciation: bilan.appreciation,
    genereLe: bilan.genereLe?.toISOString() ?? null,
    publieLe: bilan.publieLe?.toISOString() ?? null,
  };
}

function metaDeBulletin(card: ReportCard): BulletinPourPdf['meta'] {
  return {
    version: card.version,
    statut: card.statut,
    ...(card.publieLe ? { publieLe: card.publieLe.toISOString() } : {}),
    ...(card.genereLe ? { genereLe: card.genereLe.toISOString() } : {}),
    ...(card.motifCorrection ? { motifCorrection: card.motifCorrection } : {}),
  };
}

function metaDeBilan(bilan: AnnualSummary): MetaBulletin {
  return {
    version: bilan.version,
    statut: bilan.statut,
    ...(bilan.publieLe ? { publieLe: bilan.publieLe.toISOString() } : {}),
    ...(bilan.genereLe ? { genereLe: bilan.genereLe.toISOString() } : {}),
  };
}

function textesDe(card: ReportCard): BulletinPourPdf['textes'] {
  return { mention: card.mention, appreciation: card.appreciation };
}

function envoyerPdf(res: Response, nom: string, produit: { pdf: Buffer; pages: number }): void {
  const sur = nom.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'document';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${sur}.pdf"`);
  res.setHeader('X-Contenu-Pages', String(produit.pages));
  res.send(produit.pdf);
}

function listeIds(req: { query: Record<string, unknown> }): string[] {
  const brut = typeof req.query.ids === 'string' ? req.query.ids : '';
  return brut
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/**
 * @openapi
 * /api/report-cards:
 *   get:
 *     summary: Bulletins courants d'une classe (ou d'un élève) pour un semestre
 *     tags: [Bulletins]
 *     parameters:
 *       - in: query
 *         name: classroomId
 *         schema: { type: string }
 *       - in: query
 *         name: enrollmentId
 *         schema: { type: string }
 *       - in: query
 *         name: semesterId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Une ligne par élève actif, bulletin présent ou non }
 *       400: { description: semesterId manquant, ou ni classe ni élève }
 *       404: { description: Classe ou élève hors de l'établissement }
 */
router.get('/report-cards', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const semesterId = typeof req.query.semesterId === 'string' ? req.query.semesterId : '';
  const classroomId = typeof req.query.classroomId === 'string' ? req.query.classroomId : '';
  const enrollmentId = typeof req.query.enrollmentId === 'string' ? req.query.enrollmentId : '';
  if (!semesterId) throw new HttpError(400, 'Paramètre semesterId requis');
  if (!classroomId && !enrollmentId) throw new HttpError(400, 'Paramètre classroomId ou enrollmentId requis');

  const semestre = await prisma.semester.findFirst({
    where: { id: semesterId, academicYear: { schoolId, deletedAt: null } },
    include: { academicYear: true },
  });
  if (!semestre) throw new HttpError(404, 'Semestre introuvable pour cet établissement');

  const where: Record<string, unknown> = {
    schoolId,
    status: 'ACTIVE',
    deletedAt: null,
    ...(classroomId ? { classroomId } : { id: enrollmentId }),
  };
  const inscriptions = await prisma.enrollment.findMany({
    where,
    include: { student: true, classroom: { include: { level: true } } },
    orderBy: [{ student: { lastName: 'asc' } }, { student: { firstNames: 'asc' } }],
  });
  if (inscriptions.length === 0) throw new HttpError(404, 'Aucun élève actif trouvé pour ce filtre');

  const cartes = await prisma.reportCard.findMany({
    where: {
      schoolId,
      semesterId,
      estCourant: true,
      deletedAt: null,
      enrollmentId: { in: inscriptions.map((e) => e.id) },
    },
  });
  const parEleve = new Map(cartes.map((c) => [c.enrollmentId, c]));

  res.json({
    semestre: {
      id: semestre.id,
      numero: semestre.number,
      nom: semestre.name,
      academicYearId: semestre.academicYearId,
      anneeScolaire: semestre.academicYear.name,
    },
    lignes: inscriptions.map((e) => {
      const card = parEleve.get(e.id) ?? null;
      return {
        enrollmentId: e.id,
        studentId: e.student.id,
        matricule: e.student.matricule,
        nom: e.student.lastName,
        prenoms: e.student.firstNames,
        classe: e.classroom.name,
        niveau: e.classroom.level?.name ?? null,
        bulletin: card ? resumeBulletin(card) : null,
      };
    }),
  });
}));

/**
 * @openapi
 * /api/report-cards/comparaison:
 *   get:
 *     summary: Comparaison S1 / S2 d'un élève, à partir des snapshots figés
 *     tags: [Bulletins]
 *     parameters:
 *       - in: query
 *         name: enrollmentId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: academicYearId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deux semestres, moyennes figées et écarts calculés serveur }
 *       404: { description: Élève hors de l'établissement }
 *       422: { description: Année scolaire sans ses deux semestres }
 * /api/report-cards/pdf:
 *   get:
 *     summary: Impression PDF A4, un bulletin ou tout un lot
 *     tags: [Bulletins]
 *     parameters:
 *       - in: query
 *         name: ids
 *         schema: { type: string }
 *         description: Identifiants séparés par des virgules (max 60)
 *       - in: query
 *         name: classroomId
 *         schema: { type: string }
 *       - in: query
 *         name: semesterId
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Flux PDF, une page par élève au minimum
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 *       400: { description: 'Aucun bulletin sélectionné, ou filtre incomplet' }
 *       404: { description: 'Bulletin hors de l établissement, ou aucun bulletin à imprimer' }
 *       422: { description: 'Lot trop grand : le maximum est de 60 bulletins par impression' }
 */
router.get('/report-cards/comparaison', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const enrollmentId = typeof req.query.enrollmentId === 'string' ? req.query.enrollmentId : '';
  const academicYearId = typeof req.query.academicYearId === 'string' ? req.query.academicYearId : '';
  if (!enrollmentId || !academicYearId) {
    throw new HttpError(400, 'Paramètres enrollmentId et academicYearId requis');
  }
  res.json(await comparerSemestres({ schoolId, enrollmentId, academicYearId }));
}));

router.get('/report-cards/pdf', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const ids = listeIds(req);
  const classroomId = typeof req.query.classroomId === 'string' ? req.query.classroomId : '';
  const semesterId = typeof req.query.semesterId === 'string' ? req.query.semesterId : '';

  let cartes: ReportCard[] = [];
  let libelle = 'bulletins';

  if (ids.length > 0) {
    cartes = await prisma.reportCard.findMany({
      where: { schoolId, id: { in: ids }, deletedAt: null },
    });
    if (cartes.length !== ids.length) {
      throw new HttpError(404, 'Au moins un bulletin est introuvable pour cet établissement');
    }
    const ordreDemande = new Map(ids.map((id, index) => [id, index]));
    cartes.sort((a, b) => (ordreDemande.get(a.id) ?? 0) - (ordreDemande.get(b.id) ?? 0));
  } else if (classroomId && semesterId) {
    const inscriptions = await prisma.enrollment.findMany({
      where: { schoolId, classroomId, status: 'ACTIVE', deletedAt: null },
      orderBy: [{ student: { lastName: 'asc' } }, { student: { firstNames: 'asc' } }],
      select: { id: true },
    });
    if (inscriptions.length === 0) throw new HttpError(404, 'Aucun élève actif dans cette classe');
    cartes = await prisma.reportCard.findMany({
      where: {
        schoolId,
        semesterId,
        estCourant: true,
        deletedAt: null,
        enrollmentId: { in: inscriptions.map((e) => e.id) },
      },
      include: { enrollment: { include: { student: true } } },
      orderBy: [{ enrollment: { student: { lastName: 'asc' } } }],
    });
    libelle = 'bulletins-classe';
  } else {
    throw new HttpError(400, 'Paramètre ids, ou classroomId avec semesterId');
  }

  if (cartes.length === 0) throw new HttpError(404, 'Aucun bulletin à imprimer');
  if (cartes.length > MAX_PAR_LOT) {
    throw new HttpError(422, `Lot trop grand : ${MAX_PAR_LOT} bulletins maximum par impression`);
  }

  const items: BulletinPourPdf[] = cartes.map((card) => {
    const snapshot = lireSnapshot(card);
    return { snapshot, meta: metaDeBulletin(card), textes: textesDe(card) };
  });

  const produit = items.length === 1 ? await genererPdfBulletin(items[0]) : await genererPdfBulletins(items);
  envoyerPdf(res, `${libelle}-${items.length}-eleves`, produit);
}));

/**
 * @openapi
 * /api/report-cards/generate:
 *   post:
 *     summary: Générer ou régénérer le bulletin courant d'un élève
 *     tags: [Bulletins]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enrollmentId: { type: string }
 *               semesterId: { type: string }
 *     responses:
 *       200: { description: Bulletin (brouillon) prêt à relire }
 *       409: { description: Bulletin déjà publié et figé }
 *       422: { description: Élève non actif ou données insuffisantes }
 * /api/report-cards/generate-class:
 *   post:
 *     summary: Générer les bulletins de toute une classe (les publiés sont sautés)
 *     tags: [Bulletins]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               classroomId: { type: string }
 *               semesterId: { type: string }
 *     responses:
 *       200: { description: 'Compte rendu du lot : créés, mis à jour, ignorés' }
 * /api/report-cards/publish:
 *   post:
 *     summary: Publier (figer) plusieurs bulletins
 *     tags: [Bulletins]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ids: { type: array, items: { type: string } }
 *     responses:
 *       200: { description: Nombre de bulletins figés et déjà publiés }
 *       400: { description: Sélection vide }
 */
router.post('/report-cards/generate', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  await assertDroitsBulletin(req);
  const corps = genererSchema.parse(req.body);
  const { card, cree } = await genererBulletin({
    schoolId,
    enrollmentId: corps.enrollmentId,
    semesterId: corps.semesterId,
    userId: req.currentUser!.id,
    req,
  });
  res.status(cree ? 201 : 200).json({ bulletin: resumeBulletin(card), cree });
}));

router.post('/report-cards/generate-class', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  await assertDroitsBulletin(req);
  const corps = genererClasseSchema.parse(req.body);
  const lot = await genererBulletinsClasse({
    schoolId,
    classroomId: corps.classroomId,
    semesterId: corps.semesterId,
    userId: req.currentUser!.id,
    req,
  });
  res.json(lot);
}));

router.post('/report-cards/publish', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  await assertDroitsBulletin(req);
  const corps = idsSchema.parse(req.body);
  res.json(await publierBulletins({ schoolId, ids: corps.ids, userId: req.currentUser!.id, req }));
}));

/**
 * @openapi
 * /api/report-cards/{id}:
 *   get:
 *     summary: Détail d'un bulletin, snapshot complet et historique des versions
 *     tags: [Bulletins]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Bulletin, snapshot figé et versions antérieures }
 *       404: { description: Bulletin hors de l'établissement }
 *   patch:
 *     summary: Champs libres (mention, appréciations) avant publication
 *     tags: [Bulletins]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               mention: { type: string, nullable: true }
 *               appreciation: { type: string, nullable: true }
 *               appreciationsParMatiere:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     subjectId: { type: string }
 *                     appreciation: { type: string, nullable: true }
 *     responses:
 *       200: { description: Bulletin mis à jour }
 *       409: { description: 'Bulletin publié : passer par une correction versionnée' }
 */
async function chargerBulletin(schoolId: string, id: string): Promise<ReportCard> {
  const card = await prisma.reportCard.findFirst({ where: { schoolId, id, deletedAt: null } });
  if (!card) throw new HttpError(404, 'Bulletin introuvable pour cet établissement');
  return card;
}

router.get('/report-cards/:id', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const card = await chargerBulletin(schoolId, req.params.id);
  const historique = await historiqueVersions({
    schoolId,
    enrollmentId: card.enrollmentId,
    semesterId: card.semesterId,
  });
  res.json({
    bulletin: resumeBulletin(card),
    snapshot: lireSnapshot(card),
    historique: historique.map((v) => ({
      ...v,
      moyenneGenerale: texte(v.moyenneGenerale),
      genereLe: v.genereLe?.toISOString() ?? null,
      publieLe: v.publieLe?.toISOString() ?? null,
    })),
  });
}));

/**
 * @openapi
 * /api/report-cards/{id}/pdf:
 *   get:
 *     summary: Bulletin en PDF A4, rendu du snapshot figé
 *     tags: [Bulletins]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Flux PDF
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 *       404: { description: 'Bulletin hors de l établissement' }
 * /api/report-cards/{id}/correct:
 *   post:
 *     summary: Correction versionnée d un bulletin publié (motif obligatoire)
 *     tags: [Bulletins]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               motif: { type: string, minLength: 3 }
 *     responses:
 *       201: { description: 'Nouvelle version du bulletin, ancienne archivée intacte' }
 *       400: { description: 'Motif absent ou trop court' }
 *       409: { description: 'Le bulletin n est pas publié : régénération du brouillon' }
 */
router.get('/report-cards/:id/pdf', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const card = await chargerBulletin(schoolId, req.params.id);
  const snapshot = lireSnapshot(card);
  const produit = await genererPdfBulletin({
    snapshot,
    meta: metaDeBulletin(card),
    textes: textesDe(card),
  });
  envoyerPdf(res, `bulletin-${snapshot.eleve.matricule}-S${snapshot.enTete.semestre.numero}-v${card.version}`, produit);
}));

router.post('/report-cards/:id/correct', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  await assertDroitsBulletin(req);
  const corps = corrigerSchema.parse(req.body);
  const card = await chargerBulletin(schoolId, req.params.id);
  const nouvelle = await corrigerBulletin({
    schoolId,
    reportCardId: card.id,
    userId: req.currentUser!.id,
    motif: corps.motif,
    req,
  });
  res.status(201).json({ bulletin: resumeBulletin(nouvelle) });
}));

router.patch('/report-cards/:id', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  await assertDroitsBulletin(req);
  const corps = champsLibresSchema.parse(req.body);
  const card = await chargerBulletin(schoolId, req.params.id);
  const maj = await modifierChampsLibres({
    schoolId,
    reportCardId: card.id,
    userId: req.currentUser!.id,
    req,
    ...(corps.mention !== undefined ? { mention: corps.mention ?? null } : {}),
    ...(corps.appreciation !== undefined ? { appreciation: corps.appreciation ?? null } : {}),
    ...(corps.appreciationsParMatiere
      ? {
          appreciationsParMatiere: corps.appreciationsParMatiere.map((a) => ({
            subjectId: a.subjectId,
            appreciation: a.appreciation ?? null,
          })),
        }
      : {}),
  });
  res.json({ bulletin: resumeBulletin(maj) });
}));

/**
 * @openapi
 * /api/annual-summaries:
 *   get:
 *     summary: Bilans annuels courants d'une classe pour une année scolaire
 *     tags: [Bulletins]
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
 *       200: { description: Une ligne par élève actif, bilan présent ou non }
 * /api/annual-summaries/generate:
 *   post:
 *     summary: Générer ou régénérer le bilan annuel d'un élève
 *     tags: [Bulletins]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enrollmentId: { type: string }
 *               academicYearId: { type: string }
 *     responses:
 *       200: { description: Bilan recalculé depuis les bulletins des deux semestres }
 *       409: { description: Bilan publié et figé }
 * /api/annual-summaries/publish:
 *   post:
 *     summary: Figer plusieurs bilans annuels
 *     tags: [Bulletins]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ids: { type: array, items: { type: string } }
 *     responses:
 *       200: { description: Nombre de bilans figés }
 * /api/annual-summaries/{id}:
 *   get:
 *     summary: Détail d'un bilan annuel, snapshot inclus
 *     tags: [Bulletins]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Bilan et snapshot }
 *       404: { description: Bilan hors de l'établissement }
 *   patch:
 *     summary: Modifier mention et appréciation avant publication
 *     tags: [Bulletins]
 *     description: La décision du conseil ne peut être ajoutée qu'après validation par le circuit dédié.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               mention: { type: string, nullable: true }
 *               appreciation: { type: string, nullable: true }
 *     responses:
 *       200: { description: Bilan mis à jour }
 *       409: { description: Bilan publié et figé }
 * /api/annual-summaries/{id}/pdf:
 *   get:
 *     summary: Bilan annuel en PDF A4
 *     tags: [Bulletins]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Flux PDF du bilan annuel
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 */
router.get('/annual-summaries', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const classroomId = typeof req.query.classroomId === 'string' ? req.query.classroomId : '';
  const academicYearId = typeof req.query.academicYearId === 'string' ? req.query.academicYearId : '';
  if (!classroomId || !academicYearId) {
    throw new HttpError(400, 'Paramètres classroomId et academicYearId requis');
  }

  const annee = await prisma.academicYear.findFirst({
    where: { id: academicYearId, schoolId, deletedAt: null },
    include: { semesters: { orderBy: { number: 'asc' } } },
  });
  if (!annee) throw new HttpError(404, 'Année scolaire introuvable pour cet établissement');

  const inscriptions = await prisma.enrollment.findMany({
    where: { schoolId, classroomId, status: 'ACTIVE', deletedAt: null },
    include: { student: true, classroom: { include: { level: true } } },
    orderBy: [{ student: { lastName: 'asc' } }, { student: { firstNames: 'asc' } }],
  });

  const bilans = await prisma.annualSummary.findMany({
    where: {
      schoolId,
      academicYearId,
      estCourant: true,
      deletedAt: null,
      enrollmentId: { in: inscriptions.map((e) => e.id) },
    },
  });
  const parEleve = new Map(bilans.map((b) => [b.enrollmentId, b]));

  res.json({
    anneeScolaire: { id: annee.id, nom: annee.name, semestres: annee.semesters.map((s) => ({ id: s.id, numero: s.number, nom: s.name })) },
    lignes: inscriptions.map((e) => ({
      enrollmentId: e.id,
      studentId: e.student.id,
      matricule: e.student.matricule,
      nom: e.student.lastName,
      prenoms: e.student.firstNames,
      classe: e.classroom.name,
      niveau: e.classroom.level?.name ?? null,
      bilan: parEleve.get(e.id) ? resumeBilan(parEleve.get(e.id)!) : null,
    })),
  });
}));

/**
 * @openapi
 * /api/annual-summaries/pdf:
 *   get:
 *     summary: Impression groupée des bilans annuels (un PDF multi-pages)
 *     tags: [Bulletins]
 *     parameters:
 *       - in: query
 *         name: ids
 *         schema: { type: string }
 *         description: Identifiants séparés par des virgules (max 60)
 *       - in: query
 *         name: classroomId
 *         schema: { type: string }
 *       - in: query
 *         name: academicYearId
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Flux PDF
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 *       400: { description: 'Filtre incomplet' }
 *       404: { description: 'Aucun bilan annuel à imprimer' }
 *       422: { description: 'Lot trop grand : le maximum est de 60 bilans par impression' }
 */
router.get('/annual-summaries/pdf', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const ids = listeIds(req);
  const classroomId = typeof req.query.classroomId === 'string' ? req.query.classroomId : '';
  const academicYearId = typeof req.query.academicYearId === 'string' ? req.query.academicYearId : '';

  let bilans: AnnualSummary[] = [];
  if (ids.length > 0) {
    bilans = await prisma.annualSummary.findMany({
      where: { schoolId, id: { in: ids }, deletedAt: null },
    });
    if (bilans.length !== ids.length) {
      throw new HttpError(404, 'Au moins un bilan annuel est introuvable pour cet établissement');
    }
  } else if (classroomId && academicYearId) {
    const inscriptions = await prisma.enrollment.findMany({
      where: { schoolId, classroomId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    bilans = await prisma.annualSummary.findMany({
      where: {
        schoolId,
        academicYearId,
        estCourant: true,
        deletedAt: null,
        enrollmentId: { in: inscriptions.map((e) => e.id) },
      },
    });
  } else {
    throw new HttpError(400, 'Paramètre ids, ou classroomId avec academicYearId');
  }

  if (bilans.length === 0) throw new HttpError(404, 'Aucun bilan annuel à imprimer');
  if (bilans.length > MAX_PAR_LOT) {
    throw new HttpError(422, `Lot trop grand : ${MAX_PAR_LOT} bilans maximum par impression`);
  }

  const items: BilanPourPdf[] = bilans.map((bilan) => ({
    snapshot: bilan.snapshot as unknown as SnapshotBilanAnnuel,
    meta: metaDeBilan(bilan),
  }));
  const produit =
    items.length === 1
      ? await genererPdfBilanAnnuel(items[0].snapshot, items[0].meta)
      : await genererPdfBilansAnnuels(items);
  envoyerPdf(res, `bilans-annuels-${items.length}-eleves`, produit);
}));

router.post('/annual-summaries/generate', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  await assertDroitsBulletin(req);
  const corps = bilanSchema.parse(req.body);
  const { summary, cree } = await genererBilanAnnuel({
    schoolId,
    enrollmentId: corps.enrollmentId,
    academicYearId: corps.academicYearId,
    userId: req.currentUser!.id,
    req,
  });
  res.status(cree ? 201 : 200).json({ bilan: resumeBilan(summary), cree });
}));

router.post('/annual-summaries/publish', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  await assertDroitsBulletin(req);
  const corps = idsSchema.parse(req.body);
  res.json(await publierBilansAnnuels({ schoolId, ids: corps.ids, userId: req.currentUser!.id, req }));
}));

async function chargerBilan(schoolId: string, id: string): Promise<AnnualSummary> {
  const bilan = await prisma.annualSummary.findFirst({ where: { schoolId, id, deletedAt: null } });
  if (!bilan) throw new HttpError(404, 'Bilan annuel introuvable pour cet établissement');
  return bilan;
}

router.get('/annual-summaries/:id', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const bilan = await chargerBilan(schoolId, req.params.id);
  res.json({
    bilan: resumeBilan(bilan),
    snapshot: bilan.snapshot as unknown as SnapshotBilanAnnuel,
  });
}));

router.patch('/annual-summaries/:id', requireCsrf, asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  await assertDroitsBulletin(req);
  const corps = champsBilanSchema.parse(req.body);
  const bilan = await chargerBilan(schoolId, req.params.id);
  if (bilan.statut === 'PUBLIE') {
    throw new HttpError(409, 'Bilan annuel publié : une correction versionnée est nécessaire');
  }
  const snapshot = bilan.snapshot as unknown as SnapshotBilanAnnuel;
  const nextSnapshot: SnapshotBilanAnnuel = {
    ...snapshot,
    ...(corps.mention !== undefined ? { mention: corps.mention ?? null } : {}),
    ...(corps.appreciation !== undefined ? { appreciation: corps.appreciation ?? null } : {}),
  };
  const updated = await prisma.annualSummary.update({
    where: { id: bilan.id },
    data: {
      ...(corps.mention !== undefined ? { mention: corps.mention ?? null } : {}),
      ...(corps.appreciation !== undefined ? { appreciation: corps.appreciation ?? null } : {}),
      snapshot: nextSnapshot as unknown as Prisma.InputJsonValue,
    },
  });
  await writeAuditLog({
    req,
    schoolId,
    userId: req.currentUser!.id,
    action: 'ANNUAL_SUMMARY_UPDATED',
    entityType: 'AnnualSummary',
    entityId: updated.id,
    metadata: {
      before: { mention: bilan.mention, appreciation: bilan.appreciation },
      after: { mention: updated.mention, appreciation: updated.appreciation },
    },
  });
  res.json({ bilan: resumeBilan(updated), snapshot: nextSnapshot });
}));

router.get('/annual-summaries/:id/pdf', asyncHandler(async (req, res) => {
  const schoolId = requireSchoolId(req);
  const bilan = await chargerBilan(schoolId, req.params.id);
  const snapshot = bilan.snapshot as unknown as SnapshotBilanAnnuel;
  const produit = await genererPdfBilanAnnuel(snapshot, {
    version: bilan.version,
    statut: bilan.statut,
    ...(bilan.publieLe ? { publieLe: bilan.publieLe.toISOString() } : {}),
    ...(bilan.genereLe ? { genereLe: bilan.genereLe.toISOString() } : {}),
  });
  envoyerPdf(res, `bilan-annuel-${snapshot.eleve.matricule}-v${bilan.version}`, produit);
}));

export const reportCardsRouter = router;
