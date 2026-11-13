/**
 * Types du bulletin (phase 5).
 *
 * Un bulletin est une **photo figée** : le `snapshot` contient tout ce qui est nécessaire
 * pour réafficher et réimprimer le document des années plus tard, sans relecture
 * des notes ni des paramètres de l'établissement. Un bulletin publié ne se recalcule
 * donc jamais : une correction passe par une nouvelle version.
 *
 * Aucune valeur inventée : ce qui n'est pas calculable vaut `null` + un motif explicite,
 * et le PDF affiche « Non calculable » plutôt qu'un 0.
 */

export const VERSION_SNAPSHOT = 1;

export type CategorieSnapshot = 'DEVOIR' | 'COMPOSITION' | 'AUTRE';

/** Une note retenue dans le calcul, telle quelle au moment de la génération. */
export interface NoteSnapshot {
  assessmentId: string;
  title: string;
  typeId: string;
  typeName: string;
  category: CategorieSnapshot;
  statutEvaluation: string;
  outOf: string;
  score: string | null;
  status: 'SAISIE' | 'ABSENT' | 'ANNULEE' | 'NON_SAISIE';
}

export interface GroupeSnapshot {
  category: CategorieSnapshot;
  poids: string;
  moyenne: string | null;
  moyenneAffichee: string | null;
  notesValides: number;
  /** Notes attendues pour le groupe : la différence avec `notesValides` matérialise les manques. */
  notesAttendues: number;
  notes: NoteSnapshot[];
}

export interface MatiereSnapshot {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  coefficient: string | null;
  coefficientValide: boolean;
  comptabilisee: boolean;
  moyenne: string | null;
  moyenneExacte: string | null;
  moyenneAffichee: string | null;
  pointsPonderes: string | null;
  rang: number | null;
  incomplet: boolean;
  motifs: string[];
  groupes: GroupeSnapshot[];
  /** Appréciation du professeur : renseignée par l'établissement, jamais générée. */
  appreciation: string | null;
}

export interface SyntheseSnapshot {
  totalPoints: string;
  totalCoeficients: string;
  moyenneGenerale: string | null;
  moyenneGeneraleExacte: string | null;
  moyenneGeneraleAffichee: string | null;
  rang: number | null;
  motifNonClasse: string | null;
  effectif: number;
  moyenneClasse: string | null;
  moyenneClasseExacte: string | null;
  moyenneClasseAffichee: string | null;
  incomplet: boolean;
}

export interface EnTeteSnapshot {
  etablissementId: string;
  nomEtablissement: string;
  nomOfficiel: string | null;
  ville: string | null;
  adresse: string | null;
  telephone: string | null;
  email: string | null;
  agrement: string | null;
  /** Logo figé dans le snapshot (data URL PNG/JPEG), absent des anciens bulletins. */
  logoDataUrl?: string | null;
  /** Textes laissés vides tant que l'établissement ne les a pas fournis (rien d'inventé). */
  autorite: string | null;
  devise: string | null;
  intituleDocument: string;
  anneeScolaire: { id: string; nom: string; statut: string };
  semestre: { id: string; numero: number; nom: string };
}

export interface EleveSnapshot {
  enrollmentId: string;
  studentId: string;
  classroomId: string;
  matricule: string;
  nom: string;
  prenoms: string;
  birthDate: string | null;
  birthPlace: string | null;
  sexe: string | null;
  niveau: string | null;
  classe: string;
  serie: string | null;
}

export interface ReglesSnapshot {
  formuleMatiere: string;
  poidsGroupes: Record<CategorieSnapshot, string>;
  arrondiDecimales: number;
  arrondiMode: string;
  rangMode: string;
  baremeParDefaut: string;
  normaliserSur20: boolean;
  absencesComptentZero: boolean;
  groupeSansNote: string;
  coefficientInvalide: string;
  classerResultatsIncomplets: boolean;
  poidsSemestres: { s1: string; s2: string };
  annuelSiSemestreManquant: string;
}

export interface ContinuiteSnapshot {
  /** Bulletin du semestre précédent (S1 réutilisé pour S2), si un lien existe. */
  semestrePrecedent: {
    reportCardId: string | null;
    version: number | null;
    numero: number | null;
    moyenneGenerale: string | null;
    moyenneGeneraleAffichee: string | null;
    rang: number | null;
    statut: string | null;
  } | null;
  changementClasse: boolean;
  classePrecedente: string | null;
}

export interface SnapshotAbsences {
  disponible: boolean;
  absencesJustifiees: number;
  absencesNonJustifiees: number;
  absencesTotal: number;
  retards: number;
  minutesRetard: number;
}

export interface SnapshotBulletin {
  versionSchema: number;
  genereLe: string;
  dateCalcul: string;
  enTete: EnTeteSnapshot;
  eleve: EleveSnapshot;
  regles: ReglesSnapshot;
  matieres: MatiereSnapshot[];
  synthese: SyntheseSnapshot;
  continuite: ContinuiteSnapshot;
  /** Le module absences arrive en phase 6 : rien n'est simulé en attendant. */
  absences?: SnapshotAbsences;
  motifs: string[];
}

export interface SnapshotBilanAnnuel {
  versionSchema: number;
  genereLe: string;
  enTete: Omit<EnTeteSnapshot, 'semestre'>;
  eleve: EleveSnapshot;
  regles: ReglesSnapshot;
  semestres: {
    numero: number;
    nom: string;
    reportCardId: string | null;
    version: number | null;
    statut: string | null;
    moyenneGenerale: string | null;
    moyenneGeneraleAffichee: string | null;
    rang: number | null;
    effectif: number | null;
  }[];
  matieres: {
    subjectId: string;
    subjectName: string;
    coefficient: string | null;
    s1: string | null;
    s2: string | null;
    s1Affichee: string | null;
    s2Affichee: string | null;
    annuelle: string | null;
    annuelleAffichee: string | null;
    motifs: string[];
  }[];
  annuelle: {
    moyenne: string | null;
    moyenneExacte: string | null;
    moyenneAffichee: string | null;
    calculable: boolean;
    partiel: boolean;
    rangAnnuel: number | null;
    effectif: number;
    motifs: string[];
  };
  absences?: SnapshotAbsences;
  appreciation: string | null;
  mention: string | null;
  decisionConseil: string | null;
  decisionConseilValideeLe?: string | null;
}
