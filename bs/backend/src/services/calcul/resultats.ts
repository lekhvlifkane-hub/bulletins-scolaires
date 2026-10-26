import { prisma } from '../../db/prisma';
import { HttpError } from '../../lib/http';
import { parametresEtablissement } from './etablissement';
import {
  classerEleves,
  calculerMoyenneAnnuelle,
  calculerResultatsEleve,
  formaterNote,
  type MatiereInput,
  type ParametresCalcul,
  type ResultatEleve,
  type ResultatMatiere,
} from './index';
import Decimal from 'decimal.js';

type StatutEvaluationPriseEnCompte = 'VALIDEE' | 'PUBLIEE';

export interface EleveResultat {
  enrollmentId: string;
  studentId: string;
  matricule: string;
  nom: string;
  prenoms: string;
  moyenneGenerale: Decimal | null;
  totalPoints: Decimal;
  totalCoeficients: Decimal;
  incomplet: boolean;
  rang: number | null;
  motifNonClasse: string | null;
  matieres: ResultatMatiere[];
  moyennesParMatiere: Record<string, Decimal | null>;
}

export interface ResultatsClasse {
  classroomId: string;
  semesterId: string | null;
  effectif: number;
  moyenneClasse: Decimal | null;
  eleves: EleveResultat[];
  parametres: ParametresCalcul;
  motifs: string[];
}

/**
 * Prisma `Decimal` -> moteur `decimal.js`, en repassant par la représentation exacte
 * (chaîne de caractères) : aucun flottant n'intervient, et le moteur garde ses types d'entrée.
 */
function decimalVersChaine(valeur: unknown): string | null {
  if (valeur === null || valeur === undefined) return null;
  try {
    const d = new Decimal(String(valeur));
    return d.isFinite() ? d.toFixed() : null;
  } catch {
    return null;
  }
}

async function chargerSemestrePourEcole(semesterId: string, schoolId: string) {
  const semester = await prisma.semester.findFirst({
    where: { id: semesterId, academicYear: { schoolId, deletedAt: null } },
    include: { academicYear: true },
  });
  if (!semester) throw new HttpError(404, 'Semestre introuvable pour cet établissement');
  return semester;
}

async function chargerClassesEtInscriptions(schoolId: string, classroomId: string) {
  const classroom = await prisma.classroom.findFirst({
    where: { id: classroomId, schoolId, deletedAt: null },
  });
  if (!classroom) throw new HttpError(404, 'Classe introuvable pour cet établissement');

  const enrollments = await prisma.enrollment.findMany({
    where: { schoolId, classroomId, deletedAt: null, status: 'ACTIVE' },
    include: { student: true },
    orderBy: [{ student: { lastName: 'asc' } }, { student: { firstNames: 'asc' } }],
  });
  if (enrollments.length === 0) {
    throw new HttpError(422, 'Aucun élève actif dans cette classe : rien à calculer');
  }
  return { classroom, enrollments };
}

/**
 * Calcule les résultats d'une classe à partir des données réelles de la base.
 * Par défaut seules les évaluations validées ou publiées entrent dans le calcul
 * (workflow brouillon → validé → publié) ; `inclureBrouillons` sert à la prévisualisation.
 */
export async function calculerResultatsClasse(options: {
  schoolId: string;
  classroomId: string;
  semesterId?: string | null;
  inclureBrouillons?: boolean;
  dateCalcul?: Date;
  overrides?: Partial<ParametresCalcul>;
}): Promise<ResultatsClasse> {
  const school = await prisma.school.findFirst({
    where: { id: options.schoolId, deletedAt: null },
  });
  if (!school) throw new HttpError(404, 'Établissement introuvable');

  const semester = options.semesterId
    ? await chargerSemestrePourEcole(options.semesterId, options.schoolId)
    : null;

  const { enrollments } = await chargerClassesEtInscriptions(
    options.schoolId,
    options.classroomId
  );

  const classroomSubjects = await prisma.classroomSubject.findMany({
    where: { schoolId: options.schoolId, classroomId: options.classroomId },
    include: { subject: true },
  });
  if (classroomSubjects.length === 0) {
    throw new HttpError(422, 'Aucune discipline affectée à cette classe : rien à calculer');
  }

  const assessments = await prisma.assessment.findMany({
    where: {
      schoolId: options.schoolId,
      classroomSubjectId: { in: classroomSubjects.map((c) => c.id) },
      deletedAt: null,
      ...(options.semesterId ? { semesterId: options.semesterId } : {}),
      ...(options.inclureBrouillons
        ? {}
        : { status: { in: ['VALIDEE', 'PUBLIEE'] as StatutEvaluationPriseEnCompte[] } }),
    },
    include: { type: true },
    orderBy: { position: 'asc' },
  });

  const enrollmentIds = enrollments.map((e) => e.id);
  const grades = assessments.length
    ? await prisma.grade.findMany({
        where: {
          schoolId: options.schoolId,
          assessmentId: { in: assessments.map((a) => a.id) },
          enrollmentId: { in: enrollmentIds },
          deletedAt: null,
        },
      })
    : [];

  const notesParCle = new Map<string, (typeof grades)[number]>();
  for (const grade of grades) {
    notesParCle.set(`${grade.assessmentId}|${grade.enrollmentId}`, grade);
  }

  const params = parametresEtablissement(school, {
    ...(options.dateCalcul ? { dateCalcul: options.dateCalcul } : {}),
    ...(options.overrides ?? {}),
  });

  const motifsGlobaux: string[] = [];
  if (!options.inclureBrouillons) {
    const brouillons = await prisma.assessment.count({
      where: {
        schoolId: options.schoolId,
        classroomSubjectId: { in: classroomSubjects.map((c) => c.id) },
        deletedAt: null,
        status: { notIn: ['VALIDEE', 'PUBLIEE'] },
        ...(options.semesterId ? { semesterId: options.semesterId } : {}),
      },
    });
    if (brouillons > 0) {
      motifsGlobaux.push(
        `${brouillons} évaluation(s) non validée(s) exclue(s) du calcul (prévisualisation possible avec inclureBrouillons)`
      );
    }
  }

  const eleves: EleveResultat[] = [];

  for (const enrollment of enrollments) {
    const matieres: MatiereInput[] = classroomSubjects.map((cs) => ({
      subjectId: cs.subjectId,
      subjectName: cs.subject.name,
      coefficient: decimalVersChaine(cs.coefficient),
      effectiveFrom: cs.effectiveFrom,
      effectiveTo: cs.effectiveTo,
      evaluations: assessments
        .filter((a) => a.classroomSubjectId === cs.id)
        .map((a) => {
          const grade = notesParCle.get(`${a.id}|${enrollment.id}`);
          return {
            assessmentId: a.id,
            category: a.type.category,
            notes: [
              grade
                ? {
                    status: grade.status,
                    score: grade.score === null ? null : decimalVersChaine(grade.score),
                    outOf: decimalVersChaine(a.outOf) ?? undefined,
                  }
                : { status: 'NON_SAISIE' as const, score: null },
            ],
          };
        }),
    }));

    const resultat: ResultatEleve = calculerResultatsEleve(matieres, params);
    const moyennesParMatiere: Record<string, Decimal | null> = {};
    for (const m of resultat.matieres) {
      moyennesParMatiere[m.subjectId] = m.moyenne;
    }

    eleves.push({
      enrollmentId: enrollment.id,
      studentId: enrollment.studentId,
      matricule: enrollment.student.matricule,
      nom: enrollment.student.lastName,
      prenoms: enrollment.student.firstNames,
      moyenneGenerale: resultat.moyenneGenerale,
      totalPoints: resultat.totalPoints,
      totalCoeficients: resultat.totalCoeficients,
      incomplet: resultat.incomplet,
      rang: null,
      motifNonClasse: null,
      matieres: resultat.matieres,
      moyennesParMatiere,
    });
  }

  const classement = classerEleves(
    eleves.map((e) => ({ eleveId: e.enrollmentId, moyenne: e.moyenneGenerale, incomplet: e.incomplet })),
    params
  );
  for (const rangee of classement) {
    const eleve = eleves.find((e) => e.enrollmentId === rangee.eleveId);
    if (eleve) {
      eleve.rang = rangee.rang;
      eleve.motifNonClasse = rangee.motifExclusion;
    }
  }

  const classables = eleves
    .map((e) => e.moyenneGenerale)
    .filter((m): m is Decimal => m !== null);
  const moyenneClasse = classables.length
    ? classables.reduce((acc, v) => acc.plus(v), new Decimal(0)).div(classables.length)
    : null;

  return {
    classroomId: options.classroomId,
    semesterId: semester?.id ?? null,
    effectif: enrollments.length,
    moyenneClasse,
    eleves,
    parametres: params,
    motifs: motifsGlobaux,
  };
}

/**
 * Bilan annuel d'une classe : S1, S2 et moyenne annuelle selon la formule de l'établissement.
 * Un seul semestre calculé ne produit jamais une annuelle : elle est non calculable,
 * ou partielle si l'établissement a expressément configuré ce mode.
 */
export async function calculerBilanAnnuel(options: {
  schoolId: string;
  classroomId: string;
  academicYearId: string;
}): Promise<{
  effectif: number;
  eleves: {
    enrollmentId: string;
    matricule: string;
    nom: string;
    prenoms: string;
    s1: Decimal | null;
    s2: Decimal | null;
    annuelle: Decimal | null;
    calculable: boolean;
    partiel: boolean;
    motifs: string[];
    affichage: string | null;
  }[];
}> {
  const school = await prisma.school.findFirst({
    where: { id: options.schoolId, deletedAt: null },
  });
  if (!school) throw new HttpError(404, 'Établissement introuvable');

  const semestres = await prisma.semester.findMany({
    where: { academicYearId: options.academicYearId, academicYear: { schoolId: options.schoolId } },
    orderBy: { number: 'asc' },
  });
  if (semestres.length !== 2) {
    throw new HttpError(422, "L'année scolaire doit disposer de ses deux semestres");
  }

  const parSemestre = await Promise.all(
    semestres.map((s) =>
      calculerResultatsClasse({
        schoolId: options.schoolId,
        classroomId: options.classroomId,
        semesterId: s.id,
      })
    )
  );
  const [s1, s2] = parSemestre as [ResultatsClasse, ResultatsClasse];
  const params = parametresEtablissement(school);

  const eleves = s1.eleves.map((eleveS1) => {
    const moyenneS1 = eleveS1.moyenneGenerale;
    const moyenneS2 =
      s2.eleves.find((e) => e.enrollmentId === eleveS1.enrollmentId)?.moyenneGenerale ?? null;
    const annuel = calculerMoyenneAnnuelle(moyenneS1, moyenneS2, params);
    return {
      enrollmentId: eleveS1.enrollmentId,
      matricule: eleveS1.matricule,
      nom: eleveS1.nom,
      prenoms: eleveS1.prenoms,
      s1: moyenneS1,
      s2: moyenneS2,
      annuelle: annuel.moyenne,
      calculable: annuel.calculable,
      partiel: annuel.partiel,
      motifs: annuel.motifs,
      affichage: formaterNote(annuel.moyenne, params.decimalsAffichage, params.arrondi),
    };
  });

  return { effectif: eleves.length, eleves };
}
