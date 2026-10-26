import { api } from './api';

/**
 * Types et appels du module « Notes et calculs ».
 * Règle du projet : aucun calcul n'est fait ici. Le frontend affiche ce que le
 * backend a calculé (valeur exacte + valeur déjà formatée pour l'affichage).
 */

export type StatutNote = 'SAISIE' | 'ABSENT' | 'ANNULEE' | 'NON_SAISIE';
export type StatutEvaluation =
  | 'BOUILLON'
  | 'SAISIE_EN_COURS'
  | 'A_VERIFIER'
  | 'VALIDEE'
  | 'PUBLIEE';
export type CategorieEvaluation = 'DEVOIR' | 'COMPOSITION' | 'AUTRE';

export interface LigneNote {
  enrollmentId: string;
  studentId: string;
  matricule: string;
  nom: string;
  prenoms: string;
  gradeId: string | null;
  score: string | null;
  status: StatutNote;
  observation: string | null;
}

export interface GrilleSaisie {
  assessment: {
    id: string;
    title: string;
    status: StatutEvaluation;
    outOf: string;
    saisieAutorisee: boolean;
  };
  lignes: LigneNote[];
}

export interface Evaluation {
  id: string;
  title: string;
  position: number;
  status: StatutEvaluation;
  outOf: string;
  date: string | null;
  validatedAt: string | null;
  publishedAt: string | null;
  classroomId: string;
  classroomName: string;
  subjectId: string;
  subjectName: string;
  semesterId: string;
  semesterName: string;
  typeId: string;
  typeName: string;
  category: CategorieEvaluation;
  notesSaisies: number;
}

export interface TypeEvaluation {
  id: string;
  code: string;
  name: string;
  category: CategorieEvaluation;
  defaultOutOf: string;
  actif: boolean;
}

export interface Affectation {
  id: string;
  classroomId: string;
  subjectId: string;
  coefficient: string;
  subject: { id: string; name: string; code: string };
  classroom: { id: string; name: string };
}

export interface Semestre {
  id: string;
  number: number;
  name: string;
}

export interface YearSemestre {
  id: string;
  name: string;
  status: string;
  semesters: Semestre[];
}

export interface Classe {
  id: string;
  name: string;
  academicYear: { id: string; name: string; status: string };
  level: { name: string } | null;
  _count: { enrollments: number };
}

export interface ResultatMatiere {
  subjectId: string;
  subjectName: string;
  coefficient: string | null;
  moyenne: string | null;
  moyenneExacte: string | null;
  pointsPonderes: string | null;
  comptabilisee: boolean;
  incomplet: boolean;
  motifs: string[];
}

export interface ResultatEleve {
  enrollmentId: string;
  studentId: string;
  matricule: string;
  nom: string;
  prenoms: string;
  moyenneGenerale: string | null;
  moyenneGeneraleExacte: string | null;
  totalPoints: string;
  totalCoeficients: string;
  rang: number | null;
  motifNonClasse: string | null;
  incomplet: boolean;
  matieres: ResultatMatiere[];
}

export interface ResultatsClasse {
  classroomId: string;
  semesterId: string | null;
  effectif: number;
  moyenneClasse: string | null;
  moyenneClasseExacte: string | null;
  motifs: string[];
  eleves: ResultatEleve[];
}

export interface BilanAnnuelEleve {
  enrollmentId: string;
  matricule: string;
  nom: string;
  prenoms: string;
  s1: string | null;
  s2: string | null;
  annuelle: string | null;
  annuelleExacte: string | null;
  calculable: boolean;
  partiel: boolean;
  motifs: string[];
}

export interface BilanAnnuel {
  effectif: number;
  eleves: BilanAnnuelEleve[];
}

/** Erreur de saisie : le backend renvoie une erreur par ligne, rien n'a été écrit. */
export class ErreurSaisie extends Error {
  erreurs: { enrollmentId: string; message: string }[];

  constructor(message: string, erreurs: { enrollmentId: string; message: string }[]) {
    super(message);
    this.name = 'ErreurSaisie';
    this.erreurs = erreurs;
  }
}

async function demander<T>(url: string, init?: RequestInit): Promise<T> {
  const reponse = await api.fetch(url, init);
  const corps = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    const message = (corps as { error?: string }).error ?? `Requête refusée (${reponse.status})`;
    const details = (corps as { details?: { erreurs?: { enrollmentId: string; message: string }[] } })
      .details;
    if (details?.erreurs) {
      throw new ErreurSaisie(message, details.erreurs);
    }
    const erreur = new Error(message) as Error & { status?: number };
    erreur.status = reponse.status;
    throw erreur;
  }
  return corps as T;
}

export function chargerClasses() {
  return demander<{ classes: Classe[] }>('/api/schooling/classes');
}

export function chargerAnnees() {
  return demander<{ years: YearSemestre[] }>('/api/schooling/years');
}

export function chargerAffectations(classroomId: string) {
  return demander<{ classroomSubjects: Affectation[] }>(
    `/api/schooling/classroom-subjects?classroomId=${encodeURIComponent(classroomId)}`
  );
}

export function chargerTypes() {
  return demander<{ types: TypeEvaluation[] }>('/api/assessment-types');
}

export function chargerEvaluations(filtre: { classroomSubjectId?: string; semesterId?: string }) {
  const params = new URLSearchParams();
  if (filtre.classroomSubjectId) params.set('classroomSubjectId', filtre.classroomSubjectId);
  if (filtre.semesterId) params.set('semesterId', filtre.semesterId);
  const query = params.toString();
  return demander<{ assessments: Evaluation[] }>(`/api/assessments${query ? `?${query}` : ''}`);
}

export function creerEvaluation(payload: {
  classroomSubjectId: string;
  semesterId: string;
  typeId: string;
  title: string;
  outOf?: string;
}) {
  return demander<{ assessment: Evaluation & { position: number } }>(
    '/api/assessments',
    { method: 'POST', body: JSON.stringify(payload) }
  );
}

export function chargerGrille(assessmentId: string) {
  return demander<GrilleSaisie>(`/api/grade-grid?assessmentId=${encodeURIComponent(assessmentId)}`);
}

export function enregistrerNotes(
  assessmentId: string,
  notes: {
    enrollmentId: string;
    score: string | null;
    status: StatutNote;
    observation?: string | null;
  }[]
) {
  return demander<{ enregistrees: number; indicateur: string }>('/api/grades', {
    method: 'PUT',
    body: JSON.stringify({ assessmentId, notes }),
  });
}

export function changerStatutEvaluation(assessmentId: string, status: StatutEvaluation) {
  return demander<{ assessment: Evaluation }>(`/api/assessments/${assessmentId}/statut`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}

export function chargerCalculs(options: {
  classroomId: string;
  semesterId?: string | null;
  inclureBrouillons?: boolean;
}) {
  const params = new URLSearchParams({ classroomId: options.classroomId });
  if (options.semesterId) params.set('semesterId', options.semesterId);
  if (options.inclureBrouillons) params.set('inclureBrouillons', 'true');
  return demander<ResultatsClasse>(`/api/calculations?${params.toString()}`);
}

export function chargerBilanAnnuel(options: { classroomId: string; academicYearId: string }) {
  const params = new URLSearchParams({
    classroomId: options.classroomId,
    academicYearId: options.academicYearId,
  });
  return demander<{ effectif: number; eleves: BilanAnnuelEleve[] }>(
    `/api/calculations/annual?${params.toString()}`
  );
}

export const LIBELLES_STATUT_NOTE: Record<StatutNote, string> = {
  SAISIE: 'Note saisie',
  ABSENT: 'Absent',
  ANNULEE: 'Note annulée',
  NON_SAISIE: 'Non saisi',
};

export const LIBELLES_STATUT_EVALUATION: Record<StatutEvaluation, string> = {
  BOUILLON: 'Brouillon',
  SAISIE_EN_COURS: 'Saisie en cours',
  A_VERIFIER: 'À vérifier',
  VALIDEE: 'Validée',
  PUBLIEE: 'Publiée',
};
