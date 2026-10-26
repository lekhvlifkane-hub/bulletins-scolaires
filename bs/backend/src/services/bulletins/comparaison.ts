import Decimal from 'decimal.js';
import type { ReportCard } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { HttpError } from '../../lib/http';
import { formaterNote, type ModeArrondi } from '../calcul';
import { chargerSemestres } from './annual';
import { lireSnapshot } from './bulletin';
import type { SnapshotBulletin } from './types';

/**
 * Comparaison des deux semestres d'un élève (phase 5).
 *
 * Tout est lu **dans les snapshots figés** des bulletins : comparer ne doit jamais
 * recalculer une moyenne, sinon le bulletin publié cesserait d'être la référence.
 * Les écarts sont calculés ici, côté serveur, avec Decimal — l'interface n'additionne rien.
 * Un semestre sans bulletin est signalé comme tel : aucun zéro, aucune valeur par défaut.
 */

export interface ComparaisonSemestre {
  semestreId: string;
  numero: number;
  nom: string;
  reportCardId: string | null;
  version: number | null;
  statut: string | null;
  moyenneGenerale: string | null;
  moyenneGeneraleAffichee: string | null;
  rang: number | null;
  effectif: number | null;
  moyenneClasse: string | null;
  incomplete: boolean;
  motifs: string[];
  matieres: {
    subjectId: string;
    subjectCode: string;
    subjectName: string;
    coefficient: string | null;
    moyenne: string | null;
    moyenneAffichee: string | null;
    rang: number | null;
  }[];
}

export interface ComparaisonSemestres {
  enrollmentId: string;
  classroomId: string;
  academicYearId: string;
  classe: string;
  anneeScolaire: string;
  bareme: string;
  semestres: ComparaisonSemestre[];
  generale: {
    ecart: string | null;
    ecartAffiche: string | null;
    motif: string | null;
  };
  matieres: {
    subjectId: string;
    subjectName: string;
    coefficient: string | null;
    s1: string | null;
    s2: string | null;
    ecart: string | null;
    ecartAffiche: string | null;
  }[];
}

/** Le formatage suit les règles du dernier bulletin disponible (celui le plus récent). */
function reglesAffichage(cards: (SnapshotBulletin | null)[]): {
  decimales: number;
  mode: ModeArrondi;
} {
  const derniere = cards.filter((c): c is SnapshotBulletin => c !== null).pop();
  return {
    decimales: derniere?.regles.arrondiDecimales ?? 2,
    mode: (derniere?.regles.arrondiMode as ModeArrondi) ?? 'half-up',
  };
}

function versCard(bulletin: ReportCard | null): SnapshotBulletin | null {
  if (!bulletin) return null;
  try {
    return lireSnapshot(bulletin);
  } catch {
    return null;
  }
}

async function bulletinCourant(schoolId: string, enrollmentId: string, semesterId: string) {
  return prisma.reportCard.findFirst({
    where: { schoolId, enrollmentId, semesterId, estCourant: true, deletedAt: null },
    orderBy: { version: 'desc' },
  });
}

/** Écart S2 - S1 en Decimal ; null et motif explicite si une des deux valeurs manque. */
function ecart(
  s1: string | null,
  s2: string | null,
  affichage: { decimales: number; mode: ModeArrondi }
): { ecart: string | null; ecartAffiche: string | null; motif: string | null } {
  if (s1 === null || s2 === null) {
    const motif =
      s1 === null && s2 === null
        ? 'aucun semestre comparé'
        : s1 === null
          ? 'semestre 1 sans moyenne : écart non calculable'
          : 'semestre 2 sans moyenne : écart non calculable';
    return { ecart: null, ecartAffiche: null, motif };
  }
  try {
    const difference = new Decimal(s2).minus(s1);
    return {
      ecart: difference.toString(),
      ecartAffiche: formaterNote(difference, affichage.decimales, affichage.mode),
      motif: null,
    };
  } catch {
    return { ecart: null, ecartAffiche: null, motif: 'valeurs illisibles : écart non calculable' };
  }
}

export async function comparerSemestres(options: {
  schoolId: string;
  enrollmentId: string;
  academicYearId: string;
}): Promise<ComparaisonSemestres> {
  const semestres = await chargerSemestres(options.schoolId, options.academicYearId);

  const enrollment = await prisma.enrollment.findFirst({
    where: { id: options.enrollmentId, schoolId: options.schoolId, deletedAt: null },
    include: { classroom: { include: { academicYear: true } } },
  });
  if (!enrollment) {
    throw new HttpError(404, 'Inscription introuvable pour cet établissement');
  }

  const cartes = [];
  for (const semestre of semestres) {
    cartes.push(await bulletinCourant(options.schoolId, options.enrollmentId, semestre.id));
  }
  const snapshots = cartes.map((c, i) => ({ bulletin: c, snapshot: versCard(c), semestre: semestres[i] }));

  const affichage = reglesAffichage(snapshots.map((s) => s.snapshot));

  const lignes: ComparaisonSemestre[] = snapshots.map(({ bulletin, snapshot, semestre }) => ({
    semestreId: semestre.id,
    numero: semestre.number,
    nom: semestre.name,
    reportCardId: bulletin?.id ?? null,
    version: bulletin?.version ?? null,
    statut: bulletin?.statut ?? null,
    moyenneGenerale: snapshot?.synthese.moyenneGenerale ?? null,
    moyenneGeneraleAffichee: snapshot?.synthese.moyenneGeneraleAffichee ?? null,
    rang: snapshot?.synthese.rang ?? null,
    effectif: snapshot?.synthese.effectif ?? null,
    moyenneClasse: snapshot?.synthese.moyenneClasse ?? null,
    incomplete: snapshot ? snapshot.synthese.incomplet : true,
    motifs: snapshot?.motifs ?? (bulletin ? [] : ['Aucun bulletin pour ce semestre']),
    matieres:
      snapshot?.matieres.map((m) => ({
        subjectId: m.subjectId,
        subjectCode: m.subjectCode,
        subjectName: m.subjectName,
        coefficient: m.coefficient,
        moyenne: m.moyenne,
        moyenneAffichee: m.moyenneAffichee,
        rang: m.rang,
      })) ?? [],
  }));

  // Union des disciplines rencontrées, dans l'ordre du premier semestre puis les ajouts.
  const parSujet = new Map<string, { subjectName: string; s1: string | null; s2: string | null }>();
  snapshots.forEach(({ snapshot }, index) => {
    for (const matiere of snapshot?.matieres ?? []) {
      const cle = matiere.subjectId;
      const actuel = parSujet.get(cle) ?? {
        subjectName: matiere.subjectName || matiere.subjectCode,
        s1: null,
        s2: null,
      };
      if (index === 0) actuel.s1 = matiere.moyenne;
      else actuel.s2 = matiere.moyenne;
      parSujet.set(cle, actuel);
    }
  });

  const coefficientParSujet = new Map<string, string | null>();
  for (const ligne of lignes) {
    for (const matiere of ligne.matieres) {
      if (!coefficientParSujet.has(matiere.subjectId)) {
        coefficientParSujet.set(matiere.subjectId, matiere.coefficient);
      }
    }
  }

  const matieres = [...parSujet.entries()].map(([subjectId, valeurs]) => {
    const difference = ecart(valeurs.s1, valeurs.s2, affichage);
    return {
      subjectId,
      subjectName: valeurs.subjectName,
      coefficient: coefficientParSujet.get(subjectId) ?? null,
      s1: valeurs.s1,
      s2: valeurs.s2,
      ecart: difference.ecart,
      ecartAffiche: difference.ecartAffiche,
    };
  });

  const generale = ecart(lignes[0]?.moyenneGenerale ?? null, lignes[1]?.moyenneGenerale ?? null, affichage);

  return {
    enrollmentId: options.enrollmentId,
    classroomId: enrollment.classroomId,
    academicYearId: options.academicYearId,
    classe: enrollment.classroom.name,
    anneeScolaire: enrollment.classroom.academicYear.name,
    bareme: snapshots.find((s) => s.snapshot !== null)?.snapshot?.regles.baremeParDefaut ?? '20',
    semestres: lignes,
    generale,
    matieres,
  };
}
