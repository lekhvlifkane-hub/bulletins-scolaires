import { Prisma, type ReportCard, type ReportCardStatus } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../../db/prisma';
import { HttpError } from '../../lib/http';
import { writeAuditLog } from '../audit';
import { controlesSanitaire, construireSnapshot } from './construction';
import type { SnapshotBulletin } from './types';

/**
 * Cycle de vie d'un bulletin (phase 5).
 *
 * - Génération : le snapshot est recalculé côté serveur et stocké tel quel.
 * - Brouillon / prêt : tant que le bulletin n'est pas publié, le recalcul remplace la
 *   version courante (l'établissement peut encore corriger coefficients et notes).
 * - Publication : figeage. Ni les colonnes, ni le snapshot, ni le PDF ne bougent plus,
 *   même si les paramètres de l'établissement changent ensuite.
 * - Correction après publication : nouvelle `version`, ancienne archivée (`estCourant`
 *   = false) et conservée intacte, motif obligatoire et journalisé.
 */

function decimal(valeur: string | null): Prisma.Decimal | null {
  if (valeur === null) return null;
  return new Prisma.Decimal(valeur);
}

/** Colonnes de synthèse recopiées depuis le snapshot (pour lister et trier sans lire le JSON). */
function colonnesDepuisSnapshot(snapshot: SnapshotBulletin) {
  return {
    moyenneGenerale: decimal(snapshot.synthese.moyenneGenerale),
    moyenneGeneraleExacte: snapshot.synthese.moyenneGeneraleExacte,
    moyenneClasse: decimal(snapshot.synthese.moyenneClasse),
    effectif: snapshot.synthese.effectif,
    rang: snapshot.synthese.rang,
    motifNonClasse: snapshot.synthese.motifNonClasse,
    totalPoints: decimal(snapshot.synthese.totalPoints),
    totalCoeficients: decimal(snapshot.synthese.totalCoeficients),
    incomplet: snapshot.synthese.incomplet,
    motifs: snapshot.motifs,
  };
}

export function lireSnapshot(card: ReportCard): SnapshotBulletin {
  const snapshot = card.snapshot as unknown as SnapshotBulletin;
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    !snapshot.enTete ||
    !snapshot.eleve ||
    !Array.isArray(snapshot.matieres) ||
    !snapshot.synthese
  ) {
    throw new HttpError(500, 'Snapshot de bulletin illisible : régénération nécessaire');
  }
  return snapshot;
}

async function chargerCourant(schoolId: string, enrollmentId: string, semesterId: string) {
  return prisma.reportCard.findFirst({
    where: { schoolId, enrollmentId, semesterId, estCourant: true, deletedAt: null },
    orderBy: { version: 'desc' },
  });
}

/**
 * Les appréciations par matière sont des champs libres saisis par l'établissement : elles
 * survivent à un recalcul (les notes, elles, sont bien recalculées). Le snapshot étant
 * remplacé intégralement, on reporte explicitement ces textes sur la nouvelle mouture.
 * Un snapshot illisible n'est pas bloquant ici : le recalcul productif prime.
 */
async function reporterAppreciations(
  ancien: ReportCard | null,
  snapshot: SnapshotBulletin,
  schoolId: string,
): Promise<void> {
  if (!ancien) return;
  let mouture: SnapshotBulletin;
  try {
    mouture = lireSnapshot(ancien);
  } catch {
    return;
  }
  const appreciations = await prisma.appreciation.findMany({
    where: {
      schoolId,
      enrollmentId: ancien.enrollmentId,
      semesterId: ancien.semesterId,
    },
    select: { subjectId: true, content: true, deletedAt: true },
  });
  const explicites = new Map(appreciations.map((item) => [item.subjectId, item]));
  for (const matiere of snapshot.matieres) {
    const explicite = explicites.get(matiere.subjectId);
    if (explicite) {
      matiere.appreciation = explicite.deletedAt ? null : explicite.content;
      continue;
    }
    const reportee = mouture.matieres.find((m) => m.subjectId === matiere.subjectId);
    if (matiere.appreciation === null && reportee?.appreciation) {
      matiere.appreciation = reportee.appreciation;
    }
  }
}

/** Génère (ou régénère) le bulletin courant d'un élève pour un semestre. */
export async function genererBulletin(options: {
  schoolId: string;
  enrollmentId: string;
  semesterId: string;
  userId: string;
  req?: Request;
}): Promise<{ card: ReportCard; cree: boolean }> {
  const snapshot = await construireSnapshot({
    schoolId: options.schoolId,
    enrollmentId: options.enrollmentId,
    semesterId: options.semesterId,
  });
  controlesSanitaire(snapshot);

  const existant = await chargerCourant(options.schoolId, options.enrollmentId, options.semesterId);
  if (existant && existant.statut === 'PUBLIE') {
    throw new HttpError(
      409,
      'Bulletin publié et figé : utilisez la correction pour créer une nouvelle version'
    );
  }

  await reporterAppreciations(existant, snapshot, options.schoolId);

  const donnees = {
    ...colonnesDepuisSnapshot(snapshot),
    snapshot: snapshot as unknown as Prisma.InputJsonValue,
    genereLe: new Date(),
    valideLe: null,
    genereParId: options.userId,
  };

  if (existant) {
    const card = await prisma.reportCard.update({
      where: { id: existant.id },
      data: { ...donnees, statut: 'BOUILLON' satisfies ReportCardStatus },
    });
    await writeAuditLog({
      ...(options.req ? { req: options.req } : {}),
      schoolId: options.schoolId,
      userId: options.userId,
      action: 'REPORT_CARD_REGENERATED',
      entityType: 'ReportCard',
      entityId: card.id,
      metadata: { version: card.version },
    });
    return { card, cree: false };
  }

  const card = await prisma.reportCard.create({
    data: {
      schoolId: options.schoolId,
      enrollmentId: options.enrollmentId,
      semesterId: options.semesterId,
      academicYearId: snapshot.enTete.anneeScolaire.id,
      version: 1,
      ...donnees,
    },
  });

  await writeAuditLog({
    ...(options.req ? { req: options.req } : {}),
    schoolId: options.schoolId,
    userId: options.userId,
    action: 'REPORT_CARD_GENERATED',
    entityType: 'ReportCard',
    entityId: card.id,
    metadata: { enrollmentId: options.enrollmentId, semesterId: options.semesterId },
  });
  return { card, cree: true };
}

/** Génération pour toute une classe : les élèves déjà publiés sont passés, pas écrasés. */
export async function genererBulletinsClasse(options: {
  schoolId: string;
  classroomId: string;
  semesterId: string;
  userId: string;
  req?: Request;
}): Promise<{ generes: number; maj: number; ignores: { enrollmentId: string; motif: string }[] }> {
  const inscriptions = await prisma.enrollment.findMany({
    where: {
      schoolId: options.schoolId,
      classroomId: options.classroomId,
      deletedAt: null,
      status: 'ACTIVE',
    },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  if (inscriptions.length === 0) {
    throw new HttpError(422, 'Aucun élève actif dans cette classe : aucun bulletin à générer');
  }

  let generes = 0;
  let maj = 0;
  const ignores: { enrollmentId: string; motif: string }[] = [];

  for (const { id: enrollmentId } of inscriptions) {
    try {
      const resultat = await genererBulletin({
        schoolId: options.schoolId,
        enrollmentId,
        semesterId: options.semesterId,
        userId: options.userId,
        ...(options.req ? { req: options.req } : {}),
      });
      if (resultat.cree) generes += 1;
      else maj += 1;
    } catch (erreur) {
      if (erreur instanceof HttpError && erreur.status === 409) {
        ignores.push({ enrollmentId, motif: 'bulletin déjà publié' });
        continue;
      }
      if (erreur instanceof HttpError && erreur.status === 422) {
        ignores.push({ enrollmentId, motif: erreur.message });
        continue;
      }
      throw erreur;
    }
  }

  await writeAuditLog({
    ...(options.req ? { req: options.req } : {}),
    schoolId: options.schoolId,
    userId: options.userId,
    action: 'REPORT_CARDS_GENERATED',
    entityType: 'Classroom',
    entityId: options.classroomId,
    metadata: { semesterId: options.semesterId, generes, maj, ignores: ignores.length },
  });

  return { generes, maj, ignores };
}

/** Fige des bulletins : seuls des bulletins non publiés peuvent être publiés. */
export async function publierBulletins(options: {
  schoolId: string;
  ids: string[];
  userId: string;
  req?: Request;
}): Promise<{ publies: number; dejaPublies: number }> {
  if (options.ids.length === 0) throw new HttpError(400, 'Aucun bulletin sélectionné');

  const cards = await prisma.reportCard.findMany({
    where: { schoolId: options.schoolId, id: { in: options.ids }, deletedAt: null },
  });
  if (cards.length !== options.ids.length) {
    throw new HttpError(404, 'Au moins un bulletin est introuvable pour cet établissement');
  }

  const aPublier = cards.filter((c) => c.statut !== 'PUBLIE');
  const dejaPublies = cards.length - aPublier.length;

  if (aPublier.length > 0) {
    await prisma.reportCard.updateMany({
      where: { id: { in: aPublier.map((c) => c.id) } },
      data: {
        statut: 'PUBLIE' satisfies ReportCardStatus,
        publieLe: new Date(),
        publieParId: options.userId,
        valideLe: new Date(),
      },
    });
    await writeAuditLog({
      req: options.req,
      schoolId: options.schoolId,
      userId: options.userId,
      action: 'REPORT_CARDS_PUBLISHED',
      entityType: 'ReportCard',
      metadata: { ids: aPublier.map((c) => c.id), nombre: aPublier.length },
    });
  }

  return { publies: aPublier.length, dejaPublies };
}

/** Champs libres du bulletin : une décision de conseil doit passer par sa validation dédiée. */
export async function modifierChampsLibres(options: {
  schoolId: string;
  reportCardId: string;
  userId: string;
  req?: Request;
  mention?: string | null;
  appreciation?: string | null;
  appreciationsParMatiere?: { subjectId: string; appreciation: string | null }[];
}): Promise<ReportCard> {
  const card = await prisma.reportCard.findFirst({
    where: { schoolId: options.schoolId, id: options.reportCardId, deletedAt: null },
  });
  if (!card) throw new HttpError(404, 'Bulletin introuvable pour cet établissement');
  if (card.statut === 'PUBLIE') {
    throw new HttpError(
      409,
      'Bulletin publié : une correction versionnée est nécessaire pour modifier le document'
    );
  }

  const snapshot = lireSnapshot(card);
  if (options.appreciationsParMatiere) {
    for (const une of options.appreciationsParMatiere) {
      const matiere = snapshot.matieres.find((m) => m.subjectId === une.subjectId);
      if (!matiere) throw new HttpError(400, `Matière inconnue dans le bulletin : ${une.subjectId}`);
      matiere.appreciation = une.appreciation;
    }
  }

  const updated = await prisma.reportCard.update({
    where: { id: card.id },
    data: {
      ...(options.mention !== undefined ? { mention: options.mention } : {}),
      ...(options.appreciation !== undefined ? { appreciation: options.appreciation } : {}),
      ...(options.appreciationsParMatiere
        ? { snapshot: snapshot as unknown as Prisma.InputJsonValue }
        : {}),
    },
  });

  await writeAuditLog({
    req: options.req,
    schoolId: options.schoolId,
    userId: options.userId,
    action: 'REPORT_CARD_UPDATED',
    entityType: 'ReportCard',
    entityId: updated.id,
    metadata: { mention: updated.mention, appreciation: updated.appreciation },
  });

  return updated;
}

/** Correction après publication : nouvelle version, ancienne conservée et archivée. */
export async function corrigerBulletin(options: {
  schoolId: string;
  reportCardId: string;
  userId: string;
  req?: Request;
  motif: string;
}): Promise<ReportCard> {
  const motif = options.motif.trim();
  if (motif.length < 3) throw new HttpError(400, 'Un motif de correction est obligatoire');

  const card = await prisma.reportCard.findFirst({
    where: { schoolId: options.schoolId, id: options.reportCardId, deletedAt: null },
  });
  if (!card) throw new HttpError(404, 'Bulletin introuvable pour cet établissement');
  if (card.statut !== 'PUBLIE') {
    throw new HttpError(
      409,
      "La correction versionnée ne s'applique qu'à un bulletin publié : régénérez le brouillon"
    );
  }

  const snapshot = await construireSnapshot({
    schoolId: options.schoolId,
    enrollmentId: card.enrollmentId,
    semesterId: card.semesterId,
  });
  controlesSanitaire(snapshot);
  await reporterAppreciations(card, snapshot, options.schoolId);

  const derniere = await prisma.reportCard.findFirst({
    where: {
      schoolId: options.schoolId,
      enrollmentId: card.enrollmentId,
      semesterId: card.semesterId,
      deletedAt: null,
    },
    select: { version: true },
    orderBy: { version: 'desc' },
  });

  const nouvelle = await prisma.$transaction(async (tx) => {
    await tx.reportCard.update({ where: { id: card.id }, data: { estCourant: false } });
    return tx.reportCard.create({
      data: {
        schoolId: options.schoolId,
        enrollmentId: card.enrollmentId,
        semesterId: card.semesterId,
        academicYearId: card.academicYearId,
        version: (derniere?.version ?? card.version) + 1,
        remplaceReportCardId: card.id,
        motifCorrection: motif,
        // Les textes saisis par l'établissement sont reconduits tels quels : la correction
        // porte sur les données de calcul, pas sur une réécriture des mentions.
        mention: card.mention,
        decisionConseil: card.decisionConseil,
        appreciation: card.appreciation,
        ...colonnesDepuisSnapshot(snapshot),
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        genereParId: options.userId,
      },
    });
  });

  await writeAuditLog({
    req: options.req,
    schoolId: options.schoolId,
    userId: options.userId,
    action: 'REPORT_CARD_CORRECTED',
    entityType: 'ReportCard',
    entityId: nouvelle.id,
    metadata: {
      versionPrecedente: card.version,
      nouvelleVersion: nouvelle.version,
      bulletinRemplace: card.id,
      motif,
    },
  });

  return nouvelle;
}

/** Histoire des versions d'un bulletin (élève + semestre), publiée en premier. */
export async function historiqueVersions(options: {
  schoolId: string;
  enrollmentId: string;
  semesterId: string;
}) {
  return prisma.reportCard.findMany({
    where: {
      schoolId: options.schoolId,
      enrollmentId: options.enrollmentId,
      semesterId: options.semesterId,
      deletedAt: null,
    },
    orderBy: { version: 'desc' },
    select: {
      id: true,
      version: true,
      statut: true,
      estCourant: true,
      moyenneGenerale: true,
      moyenneGeneraleExacte: true,
      rang: true,
      motifCorrection: true,
      remplaceReportCardId: true,
      genereLe: true,
      publieLe: true,
      genereParId: true,
      publieParId: true,
    },
  });
}
