import type Decimal from 'decimal.js';
import { prisma } from '../../db/prisma';
import { HttpError } from '../../lib/http';
import { resumeAbsences } from '../attendance';
import { classerEleves, formaterNote, type ParametresCalcul } from '../calcul';
import { calculerResultatsClasse, type EleveResultat, type ResultatsClasse } from '../calcul/resultats';
import { VERSION_SNAPSHOT, type SnapshotBulletin } from './types';

/**
 * Construction du snapshot d'un bulletin.
 *
 * Le snapshot fige : en-tête de l'établissement, identité de l'élève, règles de calcul
 * appliquées, notes retenues, moyennes (exacte + déjà formatée), points pondérés,
 * rangs matière et général, moyenne de classe, effetif, lien avec le semestre précédent.
 * Tout est produit côté serveur ; le frontend et le PDF n'ont plus qu'à afficher.
 */

function chaine(valeur: unknown): string | null {
  if (valeur === null || valeur === undefined) return null;
  return String(valeur);
}

/** `Decimal` -> chaîne exacte (et non la représentation scientifique de JS). */
function exact(valeur: Decimal | null | undefined): string | null {
  if (valeur === null || valeur === undefined) return null;
  return valeur.toString();
}

function affiche(
  valeur: Decimal | null | undefined,
  params: Pick<ParametresCalcul, 'decimalsAffichage' | 'arrondi'>
): string | null {
  return formaterNote(valeur ?? null, params.decimalsAffichage, params.arrondi);
}

function dateIso(valeur: Date | null | undefined): string | null {
  return valeur ? new Date(valeur).toISOString() : null;
}

const CATEGORIES = ['DEVOIR', 'COMPOSITION', 'AUTRE'] as const;

export interface ContexteBulletin {
  schoolId: string;
  enrollmentId: string;
  semesterId: string;
  resultats: ResultatsClasse;
  eleve: EleveResultat;
  school: NonNullable<Awaited<ReturnType<typeof chargerEtablissement>>>;
  enrollment: Awaited<ReturnType<typeof chargerInscription>>;
  semestre: Awaited<ReturnType<typeof chargerSemestre>>;
}

export async function chargerEtablissement(schoolId: string) {
  const school = await prisma.school.findFirst({ where: { id: schoolId, deletedAt: null } });
  if (!school) throw new HttpError(404, 'Établissement introuvable');
  return school;
}

export async function chargerInscription(schoolId: string, enrollmentId: string) {
  const enrollment = await prisma.enrollment.findFirst({
    where: { id: enrollmentId, schoolId, deletedAt: null },
    include: {
      student: true,
      classroom: { include: { academicYear: true, level: true, series: true } },
    },
  });
  if (!enrollment) throw new HttpError(404, 'Inscription introuvable pour cet établissement');
  return enrollment;
}

export async function chargerSemestre(schoolId: string, semesterId: string) {
  const semestre = await prisma.semester.findFirst({
    where: { id: semesterId, academicYear: { schoolId, deletedAt: null } },
    include: { academicYear: true },
  });
  if (!semestre) throw new HttpError(404, 'Semestre introuvable pour cet établissement');
  return semestre;
}

/** Contexte complet nécessaire au snapshot (regroupé ici pour ne rien calculer deux fois). */
export async function preparerContexte(options: {
  schoolId: string;
  enrollmentId: string;
  semesterId: string;
  dateCalcul?: Date;
}): Promise<ContexteBulletin> {
  const school = await chargerEtablissement(options.schoolId);
  const enrollment = await chargerInscription(options.schoolId, options.enrollmentId);
  const semestre = await chargerSemestre(options.schoolId, options.semesterId);

  const resultats = await calculerResultatsClasse({
    schoolId: options.schoolId,
    classroomId: enrollment.classroomId,
    semesterId: options.semesterId,
    ...(options.dateCalcul ? { dateCalcul: options.dateCalcul } : {}),
  });

  const eleve = resultats.eleves.find((e) => e.enrollmentId === options.enrollmentId);
  if (!eleve) {
    throw new HttpError(
      422,
      "L'élève n'est pas actif dans cette classe : aucun bulletin à générer"
    );
  }

  return { schoolId: options.schoolId, enrollmentId: options.enrollmentId, semesterId: options.semesterId, resultats, eleve, school, enrollment, semestre };
}

/** Rang de l'élève dans une matière, calculé sur toute la classe (jamais dans le frontend). */
function rangsParMatiere(resultats: ResultatsClasse, params: ParametresCalcul) {
  const subjectIds = new Set<string>();
  for (const e of resultats.eleves) for (const m of e.matieres) subjectIds.add(m.subjectId);

  const parSujet = new Map<string, Map<string, { rang: number | null; motif: string | null }>>();
  for (const subjectId of subjectIds) {
    const classement = classerEleves(
      resultats.eleves.map((e) => ({
        eleveId: e.enrollmentId,
        moyenne: e.moyennesParMatiere[subjectId] ?? null,
        incomplet: e.incomplet,
      })),
      params
    );
    const map = new Map<string, { rang: number | null; motif: string | null }>();
    for (const r of classement) map.set(r.eleveId, { rang: r.rang, motif: r.motifExclusion });
    parSujet.set(subjectId, map);
  }
  return parSujet;
}

/** Notes réellement retenues, par matière puis par catégorie, + code des disciplines. */
async function notesRetenues(options: {
  schoolId: string;
  classroomId: string;
  semesterId: string;
  enrollmentId: string;
}) {
  const affects = await prisma.classroomSubject.findMany({
    where: { schoolId: options.schoolId, classroomId: options.classroomId },
    include: { subject: true },
  });
  const codes = new Map(affects.map((a) => [a.subjectId, a.subject.code]));

  const assessments = await prisma.assessment.findMany({
    where: {
      schoolId: options.schoolId,
      semesterId: options.semesterId,
      deletedAt: null,
      status: { in: ['VALIDEE', 'PUBLIEE'] },
      classroomSubject: {
        schoolId: options.schoolId,
        classroomId: options.classroomId,
      },
    },
    include: { type: true, classroomSubject: { include: { subject: true } } },
    orderBy: { position: 'asc' },
  });

  const grades = await prisma.grade.findMany({
    where: {
      schoolId: options.schoolId,
      enrollmentId: options.enrollmentId,
      assessmentId: { in: assessments.map((a) => a.id) },
      deletedAt: null,
    },
  });
  const parEvaluation = new Map(grades.map((g) => [g.assessmentId, g]));

  const parSujet = new Map<string, typeof assessments>();
  for (const a of assessments) {
    const liste = parSujet.get(a.classroomSubject.subjectId) ?? [];
    liste.push(a);
    parSujet.set(a.classroomSubject.subjectId, liste);
  }

  return { parSujet, parEvaluation, codes };
}

/** Bulletin du semestre précédent pour le même élève et la même année (continuité S1 -> S2). */
async function trouverBulletinPrecedent(options: {
  schoolId: string;
  studentId: string;
  academicYearId: string;
  numeroSemestre: number;
}) {
  if (options.numeroSemestre <= 1) return null;
  const precedents = await prisma.reportCard.findMany({
    where: {
      schoolId: options.schoolId,
      estCourant: true,
      deletedAt: null,
      semester: { number: options.numeroSemestre - 1 },
      academicYearId: options.academicYearId,
      enrollment: { studentId: options.studentId, deletedAt: null },
    },
    include: { semester: true },
    orderBy: { version: 'desc' },
  });
  return precedents[0] ?? null;
}

export async function construireSnapshot(options: {
  schoolId: string;
  enrollmentId: string;
  semesterId: string;
  dateCalcul?: Date;
}): Promise<SnapshotBulletin> {
  const ctx = await preparerContexte(options);
  const { resultats, eleve, school, enrollment, semestre } = ctx;
  const params = resultats.parametres;

  const rangs = rangsParMatiere(resultats, params);
  const { parSujet, parEvaluation, codes } = await notesRetenues({
    schoolId: options.schoolId,
    classroomId: enrollment.classroomId,
    semesterId: options.semesterId,
    enrollmentId: options.enrollmentId,
  });
  const [appreciations, absences] = await Promise.all([
    prisma.appreciation.findMany({
      where: {
        schoolId: options.schoolId,
        enrollmentId: options.enrollmentId,
        semesterId: options.semesterId,
        deletedAt: null,
      },
      select: { subjectId: true, content: true },
    }),
    resumeAbsences(options.schoolId, options.enrollmentId, [options.semesterId]),
  ]);
  const appreciationParMatiere = new Map(appreciations.map((entry) => [entry.subjectId, entry.content]));

  const matieres = eleve.matieres.map((matiere) => {
    const evaluations = parSujet.get(matiere.subjectId) ?? [];
    const groupes = CATEGORIES.map((category) => {
      const g = matiere.groupes.find((x) => x.category === category);
      if (!g) return null;
      const notes = evaluations
        .filter((a) => a.type.category === category)
        .map((a) => {
          const grade = parEvaluation.get(a.id);
          return {
            assessmentId: a.id,
            title: a.title,
            typeId: a.typeId,
            typeName: a.type.name,
            category,
            statutEvaluation: a.status,
            outOf: chaine(a.outOf) ?? '20',
            score: grade?.score === null || grade === undefined ? null : chaine(grade.score),
            status: (grade?.status ?? 'NON_SAISIE') as 'SAISIE' | 'ABSENT' | 'ANNULEE' | 'NON_SAISIE',
          };
        });
      return {
        category,
        poids: g.poids.toString(),
        moyenne: exact(g.moyenne),
        moyenneAffichee: affiche(g.moyenne, params),
        notesValides: g.notesValides,
        notesAttendues: g.notesAttendues,
        notes,
      };
    }).filter((g): g is NonNullable<typeof g> => g !== null && g.notes.length > 0);

    const rangMatiere = rangs.get(matiere.subjectId)?.get(options.enrollmentId);

    return {
      subjectId: matiere.subjectId,
      subjectName: matiere.subjectName ?? '',
      subjectCode: codes.get(matiere.subjectId) ?? '',
      coefficient: exact(matiere.coefficient),
      coefficientValide: matiere.coefficient !== null && matiere.coefficient.gt(0),
      comptabilisee: matiere.comptabilisee,
      moyenne: exact(matiere.moyenne),
      moyenneExacte: exact(matiere.moyenne),
      moyenneAffichee: affiche(matiere.moyenne, params),
      pointsPonderes: exact(matiere.pointsPonderes),
      rang: rangMatiere?.rang ?? null,
      // Le drapeau du moteur signale une moyenne partiellement calculée. Pour le
      // bulletin, une matière sans moyenne du tout est tout aussi incomplète : il
      // faut l'afficher comme telle plutôt que de la laisser neutre.
      incomplet: matiere.incomplet || matiere.moyenne === null,
      motifs: matiere.motifs,
      groupes,
      appreciation: appreciationParMatiere.get(matiere.subjectId) ?? null,
    };
  });

  const precedent = await trouverBulletinPrecedent({
    schoolId: options.schoolId,
    studentId: enrollment.studentId,
    academicYearId: enrollment.classroom.academicYearId,
    numeroSemestre: semestre.number,
  });
  const snapshotPrecedent = precedent
    ? (precedent.snapshot as unknown as SnapshotBulletin)
    : null;

  return {
    versionSchema: VERSION_SNAPSHOT,
    genereLe: new Date().toISOString(),
    dateCalcul: (options.dateCalcul ?? new Date()).toISOString(),
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
      intituleDocument: 'Bulletin de notes',
      anneeScolaire: {
        id: enrollment.classroom.academicYearId,
        nom: enrollment.classroom.academicYear.name,
        statut: enrollment.classroom.academicYear.status,
      },
      semestre: { id: semestre.id, numero: semestre.number, nom: semestre.name },
    },
    eleve: {
      enrollmentId: enrollment.id,
      studentId: enrollment.studentId,
      classroomId: enrollment.classroomId,
      matricule: enrollment.student.matricule,
      nom: enrollment.student.lastName,
      prenoms: enrollment.student.firstNames,
      birthDate: dateIso(enrollment.student.birthDate),
      birthPlace: enrollment.student.birthPlace,
      sexe: enrollment.student.sex,
      niveau: enrollment.classroom.level?.name ?? null,
      classe: enrollment.classroom.name,
      serie: enrollment.classroom.series?.name ?? null,
    },
    regles: {
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
    },
    matieres,
    synthese: {
      totalPoints: eleve.totalPoints.toString(),
      totalCoeficients: eleve.totalCoeficients.toString(),
      moyenneGenerale: exact(eleve.moyenneGenerale),
      moyenneGeneraleExacte: exact(eleve.moyenneGenerale),
      moyenneGeneraleAffichee: affiche(eleve.moyenneGenerale, params),
      rang: eleve.rang,
      motifNonClasse: eleve.motifNonClasse,
      effectif: resultats.effectif,
      moyenneClasse: exact(resultats.moyenneClasse),
      moyenneClasseExacte: exact(resultats.moyenneClasse),
      moyenneClasseAffichee: affiche(resultats.moyenneClasse, params),
      incomplet: eleve.incomplet,
    },
    continuite: {
      semestrePrecedent: precedent
        ? {
            reportCardId: precedent.id,
            version: precedent.version,
            numero: precedent.semester.number,
            moyenneGenerale: chaine(precedent.moyenneGenerale),
            moyenneGeneraleAffichee:
              snapshotPrecedent?.synthese.moyenneGeneraleAffichee ?? null,
            rang: precedent.rang,
            statut: precedent.statut,
          }
        : null,
      changementClasse:
        snapshotPrecedent !== null &&
        snapshotPrecedent.eleve.classroomId !== enrollment.classroomId,
      classePrecedente: snapshotPrecedent?.eleve.classe ?? null,
    },
    absences,
    motifs: [...resultats.motifs, ...eleve.matieres.flatMap((m) => m.motifs.map((x) => `${m.subjectName} : ${x}`))],
  };
}

/** Moyenne d'une matière sur un snapshot, pour le tableau du bulletin. */
export function moyenneMatiereAffichee(matiere: SnapshotBulletin['matieres'][number]): string {
  return matiere.moyenneAffichee ?? 'Non calculable';
}

export function totalNotes(matiere: SnapshotBulletin['matieres'][number]): number {
  return matiere.groupes.reduce((somme, g) => somme + g.notesValides, 0);
}

/** Contrôle de cohérence minimal d'un snapshot relu depuis la base. */
export function snapshotValide(value: unknown): value is SnapshotBulletin {
  const s = value as Partial<SnapshotBulletin> | null;
  return Boolean(
    s &&
      typeof s.versionSchema === 'number' &&
      s.enTete &&
      s.eleve &&
      Array.isArray(s.matieres) &&
      s.synthese
  );
}

/** Garde unique : une valeur numérique stockée est une chaîne exacte, jamais un flottant JS. */
export function gardeSansFlottant(champs: (string | number | null | undefined)[]): void {
  for (const valeur of champs) {
    if (typeof valeur === 'number') {
      throw new HttpError(500, 'Un snapshot contient un nombre flottant : usage de Decimal requis');
    }
  }
}

/** Contrôle de cohérence minimal : le snapshot ne doit contenir aucun flottant. */
export function controlesSanitaire(snapshot: SnapshotBulletin): void {
  gardeSansFlottant([
    snapshot.synthese.moyenneGenerale,
    snapshot.synthese.moyenneGeneraleExacte,
    snapshot.synthese.totalPoints,
    snapshot.synthese.totalCoeficients,
    snapshot.synthese.moyenneClasse,
    ...snapshot.matieres.map((m) => m.moyenne),
    ...snapshot.matieres.map((m) => m.moyenneExacte),
    ...snapshot.matieres.map((m) => m.coefficient),
    ...snapshot.matieres.map((m) => m.pointsPonderes),
    ...snapshot.matieres.flatMap((m) => m.groupes.map((g) => g.moyenne)),
  ]);
}
