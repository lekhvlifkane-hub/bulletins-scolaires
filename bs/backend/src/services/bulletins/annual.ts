import type Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import type { AnnualSummary, ReportCard } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../../db/prisma';
import { HttpError } from '../../lib/http';
import { calculerMoyenneAnnuelle, classerEleves, formaterNote, type ParametresCalcul } from '../calcul';
import { parametresEtablissement } from '../calcul/etablissement';
import { calculerResultatsClasse } from '../calcul/resultats';
import { writeAuditLog } from '../audit';
import { resumeAbsences } from '../attendance';
import { chargerEtablissement, chargerInscription, gardeSansFlottant } from './construction';
import { VERSION_SNAPSHOT, type SnapshotBilanAnnuel } from './types';

/**
 * Bilan annuel (phase 5).
 *
 * Le bilan n'invente aucune règle : il reprend les moyennes de semestre déjà calculées
 * (bulletins S1 et S2 quand ils existent) et applique la formule de l'établissement
 * (`poidsSemestres`, `annuelSiSemestreManquant`). Un semestre manquant rend l'annuelle
 * **non calculable** — jamais une moyenne sur un seul semestre présentée comme annuelle,
 * sauf réglage explicite « partiel ».
 *
 * La moyenne annuelle **par discipline** applique la même pondération de semestres que la
 * moyenne générale : c'est une hypothèse de travail, à valider par l'établissement
 * (voir docs/A_VALIDER.md).
 */

function exact(valeur: Decimal | null): string | null {
  return valeur === null ? null : valeur.toString();
}

export interface BilanSemestre {
  numero: number;
  nom: string;
  reportCardId: string | null;
  version: number | null;
  statut: string | null;
  moyenneGenerale: string | null;
  moyenneGeneraleAffichee: string | null;
  rang: number | null;
  effectif: number | null;
}

export async function chargerSemestres(schoolId: string, academicYearId: string) {
  const semestres = await prisma.semester.findMany({
    where: { academicYearId, academicYear: { schoolId, deletedAt: null } },
    orderBy: { number: 'asc' },
  });
  if (semestres.length !== 2) {
    throw new HttpError(422, "L'année scolaire doit disposer de ses deux semestres");
  }
  return semestres;
}

async function bulletinCourant(
  schoolId: string,
  enrollmentId: string,
  semesterId: string
): Promise<ReportCard | null> {
  return prisma.reportCard.findFirst({
    where: { schoolId, enrollmentId, semesterId, estCourant: true, deletedAt: null },
    orderBy: { version: 'desc' },
  });
}

function reglesPourBilan(params: ParametresCalcul): SnapshotBilanAnnuel['regles'] {
  return {
    formuleMatiere: params.regleMatiere,
    poidsGroupes: {
      DEVOIR: String(params.poidsGroupes.DEVOIR),
      COMPOSITION: String(params.poidsGroupes.COMPOSITION),
      AUTRE: String(params.poidsGroupes.AUTRE),
    },
    arrondiDecimales: params.decimalsAffichage,
    arrondiMode: params.arrondi,
    rangMode: params.rangMode,
    baremeParDefaut: String(params.baremeParDefaut),
    normaliserSur20: params.normaliserSur20,
    absencesComptentZero: params.absencesComptentZero,
    groupeSansNote: params.groupeSansNote,
    coefficientInvalide: params.coefficientInvalide,
    classerResultatsIncomplets: params.classerResultatsIncomplets,
    poidsSemestres: { s1: String(params.poidsSemestres.s1), s2: String(params.poidsSemestres.s2) },
    annuelSiSemestreManquant: params.annuelSiSemestreManquant,
  };
}

function motifsAnnuels(
  resultat: ReturnType<typeof calculerMoyenneAnnuelle>,
  semestres: BilanSemestre[],
  params: ParametresCalcul
): string[] {
  const motifs = [...resultat.motifs];
  const manquants = semestres.filter((s) => s.moyenneGenerale === null).map((s) => `S${s.numero}`);
  if (manquants.length > 0) {
    motifs.unshift(`Semestre(s) sans moyenne : ${manquants.join(', ')}`);
    if (params.annuelSiSemestreManquant === 'partiel') {
      motifs.push('Réglage établissement : annuelle partielle admise, à confirmer en conseil de classe');
    }
  }
  return motifs;
}

export async function construireSnapshotAnnuel(options: {
  schoolId: string;
  enrollmentId: string;
  academicYearId: string;
  dateCalcul?: Date;
}): Promise<SnapshotBilanAnnuel> {
  const school = await chargerEtablissement(options.schoolId);
  const enrollment = await chargerInscription(options.schoolId, options.enrollmentId);
  const semestres = await chargerSemestres(options.schoolId, options.academicYearId);
  const [absences, decisionValidee] = await Promise.all([
    resumeAbsences(options.schoolId, options.enrollmentId, semestres.map((s) => s.id)),
    prisma.councilDecision.findFirst({
      where: {
        schoolId: options.schoolId,
        enrollmentId: options.enrollmentId,
        academicYearId: options.academicYearId,
        status: 'VALIDEE',
        deletedAt: null,
      },
      orderBy: { version: 'desc' },
    }),
  ]);
  const params = parametresEtablissement(school, {
    ...(options.dateCalcul ? { dateCalcul: options.dateCalcul } : {}),
  });

  const resultatsParSemestre = [];
  for (const semestre of semestres) {
    resultatsParSemestre.push(
      await calculerResultatsClasse({
        schoolId: options.schoolId,
        classroomId: enrollment.classroomId,
        semesterId: semestre.id,
        ...(options.dateCalcul ? { dateCalcul: options.dateCalcul } : {}),
      })
    );
  }
  const [resultatsS1, resultatsS2] = resultatsParSemestre;

  const eleveS1 = resultatsS1.eleves.find((e) => e.enrollmentId === options.enrollmentId);
  const eleveS2 = resultatsS2.eleves.find((e) => e.enrollmentId === options.enrollmentId);
  if (!eleveS1 || !eleveS2) {
    throw new HttpError(
      422,
      "L'élève n'est pas actif dans cette classe pour les deux semestres : bilan annuel non établiable"
    );
  }

  const annuelle = calculerMoyenneAnnuelle(eleveS1.moyenneGenerale, eleveS2.moyenneGenerale, params);

  // Rang annuel : la classe entière est classée sur sa moyenne annuelle, selon les règles
  // de l'établissement. Le classement n'est jamais fait dans le frontend.
  const entrees = resultatsS1.eleves.map((eleve) => {
    const autre = resultatsS2.eleves.find((e) => e.enrollmentId === eleve.enrollmentId);
    const s1 = eleve.moyenneGenerale;
    const s2 = autre?.moyenneGenerale ?? null;
    const resultat = calculerMoyenneAnnuelle(s1, s2, params);
    return {
      enrollmentId: eleve.enrollmentId,
      moyenne: resultat.moyenne,
      incomplet: !resultat.calculable || resultat.partiel,
    };
  });
  const classement = classerEleves(
    entrees.map((entree) => ({
      eleveId: entree.enrollmentId,
      moyenne: entree.moyenne,
      incomplet: entree.incomplet,
    })),
    params
  );
  const monClassement = classement.find((r) => r.eleveId === options.enrollmentId);

  const bilanSemestres: BilanSemestre[] = [];
  for (const [index, semestre] of semestres.entries()) {
    const resultats = resultatsParSemestre[index];
    const eleve = index === 0 ? eleveS1 : eleveS2;
    const bulletin = await bulletinCourant(options.schoolId, options.enrollmentId, semestre.id);
    bilanSemestres.push({
      numero: semestre.number,
      nom: semestre.name,
      reportCardId: bulletin?.id ?? null,
      version: bulletin?.version ?? null,
      statut: bulletin?.statut ?? null,
      moyenneGenerale: exact(eleve.moyenneGenerale),
      moyenneGeneraleAffichee: formaterNote(
        eleve.moyenneGenerale,
        params.decimalsAffichage,
        params.arrondi
      ),
      rang: eleve.rang,
      effectif: resultats.effectif,
    });
  }

  const subjectIds: string[] = [];
  for (const matiere of eleveS1.matieres) subjectIds.push(matiere.subjectId);
  for (const matiere of eleveS2.matieres) {
    if (!subjectIds.includes(matiere.subjectId)) subjectIds.push(matiere.subjectId);
  }

  const matieres = subjectIds.map((subjectId) => {
    const s1 = eleveS1.matieres.find((m) => m.subjectId === subjectId) ?? null;
    const s2 = eleveS2.matieres.find((m) => m.subjectId === subjectId) ?? null;
    const resultat = calculerMoyenneAnnuelle(s1?.moyenne ?? null, s2?.moyenne ?? null, params);
    return {
      subjectId,
      subjectName: s1?.subjectName ?? s2?.subjectName ?? 'Discipline',
      coefficient: exact(s1?.coefficient ?? s2?.coefficient ?? null),
      s1: exact(s1?.moyenne ?? null),
      s2: exact(s2?.moyenne ?? null),
      s1Affichee: s1
        ? formaterNote(s1.moyenne, params.decimalsAffichage, params.arrondi)
        : null,
      s2Affichee: s2
        ? formaterNote(s2.moyenne, params.decimalsAffichage, params.arrondi)
        : null,
      annuelle: exact(resultat.moyenne),
      annuelleAffichee: formaterNote(resultat.moyenne, params.decimalsAffichage, params.arrondi),
      motifs: resultat.motifs,
    };
  });

  const snapshot: SnapshotBilanAnnuel = {
    versionSchema: VERSION_SNAPSHOT,
    genereLe: new Date().toISOString(),
    enTete: {
      etablissementId: school.id,
      nomEtablissement: school.name,
      nomOfficiel: school.officialName,
      ville: school.city,
      adresse: school.address,
      telephone: school.phone,
      email: school.email,
      agrement: school.accreditationNumber,
      autorite: null,
      devise: null,
      intituleDocument: 'Bilan annuel',
      anneeScolaire: {
        id: enrollment.classroom.academicYearId,
        nom: enrollment.classroom.academicYear.name,
        statut: enrollment.classroom.academicYear.status,
      },
    },
    eleve: {
      enrollmentId: enrollment.id,
      studentId: enrollment.studentId,
      classroomId: enrollment.classroomId,
      matricule: enrollment.student.matricule,
      nom: enrollment.student.lastName,
      prenoms: enrollment.student.firstNames,
      birthDate: enrollment.student.birthDate
        ? new Date(enrollment.student.birthDate).toISOString()
        : null,
      birthPlace: enrollment.student.birthPlace,
      sexe: enrollment.student.sex,
      niveau: enrollment.classroom.level?.name ?? null,
      classe: enrollment.classroom.name,
      serie: enrollment.classroom.series?.name ?? null,
    },
    regles: reglesPourBilan(params),
    semestres: bilanSemestres,
    matieres,
    annuelle: {
      moyenne: exact(annuelle.moyenne),
      moyenneExacte: exact(annuelle.moyenne),
      moyenneAffichee: formaterNote(annuelle.moyenne, params.decimalsAffichage, params.arrondi),
      calculable: annuelle.calculable,
      partiel: annuelle.partiel,
      rangAnnuel: monClassement?.rang ?? null,
      effectif: resultatsS1.eleves.length,
      motifs: motifsAnnuels(annuelle, bilanSemestres, params),
    },
    absences,
    // Textes libres : ils vivent en colonnes de l'AnnualSummary, jamais dans le calcul.
    appreciation: null,
    mention: null,
    decisionConseil: decisionValidee?.content ?? null,
    decisionConseilValideeLe: decisionValidee?.validatedAt?.toISOString() ?? null,
  };

  gardeSansFlottant([
    snapshot.annuelle.moyenne,
    snapshot.annuelle.moyenneExacte,
    ...snapshot.matieres.map((m) => m.s1),
    ...snapshot.matieres.map((m) => m.s2),
    ...snapshot.matieres.map((m) => m.annuelle),
    ...snapshot.matieres.map((m) => m.coefficient),
    ...snapshot.semestres.map((s) => s.moyenneGenerale),
  ]);

  return snapshot;
}

// ---------------------------------------------------------------------------
// Persistance : AnnualSummary suit le même cycle de vie que le bulletin.
// ---------------------------------------------------------------------------

function decimal(valeur: string | null): Prisma.Decimal | null {
  return valeur === null ? null : new Prisma.Decimal(valeur);
}

/** Génère ou régénère le bilan annuel courant d'un élève. Un bilan publié est figé. */
export async function genererBilanAnnuel(options: {
  schoolId: string;
  enrollmentId: string;
  academicYearId: string;
  userId: string;
  req?: Request;
}): Promise<{ summary: AnnualSummary; cree: boolean }> {
  const snapshot = await construireSnapshotAnnuel({
    schoolId: options.schoolId,
    enrollmentId: options.enrollmentId,
    academicYearId: options.academicYearId,
  });

  const existant = await prisma.annualSummary.findFirst({
    where: {
      schoolId: options.schoolId,
      enrollmentId: options.enrollmentId,
      academicYearId: options.academicYearId,
      estCourant: true,
      deletedAt: null,
    },
    orderBy: { version: 'desc' },
  });
  if (existant && existant.statut === 'PUBLIE') {
    throw new HttpError(409, 'Bilan annuel publié et figé : régénération impossible');
  }

  if (existant) {
    snapshot.mention = existant.mention;
    snapshot.appreciation = existant.appreciation;
  }

  const donnees = {
    snapshot: snapshot as unknown as Prisma.InputJsonValue,
    moyenneS1: decimal(snapshot.semestres[0]?.moyenneGenerale ?? null),
    moyenneS2: decimal(snapshot.semestres[1]?.moyenneGenerale ?? null),
    moyenneAnnuelle: decimal(snapshot.annuelle.moyenne),
    moyenneAnnuelleExacte: snapshot.annuelle.moyenneExacte,
    calculable: snapshot.annuelle.calculable,
    partiel: snapshot.annuelle.partiel,
    rangAnnuel: snapshot.annuelle.rangAnnuel,
    effectif: snapshot.annuelle.effectif,
    motifs: snapshot.annuelle.motifs,
    s1ReportCardId: snapshot.semestres[0]?.reportCardId ?? null,
    s2ReportCardId: snapshot.semestres[1]?.reportCardId ?? null,
    decisionConseil: snapshot.decisionConseil,
    genereLe: new Date(),
  };

  if (existant) {
    const summary = await prisma.annualSummary.update({
      where: { id: existant.id },
      data: { ...donnees, statut: 'BOUILLON' },
    });
    await writeAuditLog({
      ...(options.req ? { req: options.req } : {}),
      schoolId: options.schoolId,
      userId: options.userId,
      action: 'ANNUAL_SUMMARY_REGENERATED',
      entityType: 'AnnualSummary',
      entityId: summary.id,
      metadata: { version: summary.version },
    });
    return { summary, cree: false };
  }

  const summary = await prisma.annualSummary.create({
    data: {
      schoolId: options.schoolId,
      enrollmentId: options.enrollmentId,
      academicYearId: options.academicYearId,
      version: 1,
      ...donnees,
    },
  });

  await writeAuditLog({
    ...(options.req ? { req: options.req } : {}),
    schoolId: options.schoolId,
    userId: options.userId,
    action: 'ANNUAL_SUMMARY_GENERATED',
    entityType: 'AnnualSummary',
    entityId: summary.id,
    metadata: { enrollmentId: options.enrollmentId, academicYearId: options.academicYearId },
  });
  return { summary, cree: true };
}

/**
 * Fige un ou plusieurs bilans annuels. Comme le bulletin, un bilan publié ne se
 * régénère plus : il faudrait passer par une correction versionnée.
 */
export async function publierBilansAnnuels(options: {
  schoolId: string;
  ids: string[];
  userId: string;
  req?: Request;
}): Promise<{ publies: number; dejaPublies: number }> {
  if (options.ids.length === 0) throw new HttpError(400, 'Aucun bilan annuel sélectionné');

  const bilans = await prisma.annualSummary.findMany({
    where: { schoolId: options.schoolId, id: { in: options.ids }, deletedAt: null },
  });
  if (bilans.length !== options.ids.length) {
    throw new HttpError(404, 'Au moins un bilan annuel est introuvable pour cet établissement');
  }

  const aPublier = bilans.filter((b) => b.statut !== 'PUBLIE');
  if (aPublier.length > 0) {
    await prisma.annualSummary.updateMany({
      where: { id: { in: aPublier.map((b) => b.id) } },
      data: { statut: 'PUBLIE', publieLe: new Date() },
    });
    await writeAuditLog({
      ...(options.req ? { req: options.req } : {}),
      schoolId: options.schoolId,
      userId: options.userId,
      action: 'ANNUAL_SUMMARIES_PUBLISHED',
      entityType: 'AnnualSummary',
      metadata: { ids: aPublier.map((b) => b.id), nombre: aPublier.length },
    });
  }

  return { publies: aPublier.length, dejaPublies: bilans.length - aPublier.length };
}
