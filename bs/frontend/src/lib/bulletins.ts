import { api } from './api';

/**
 * Types et appels du module « Bulletins et bilans annuels » (phase 5).
 *
 * Règle du projet : aucun calcul ici. Le bulletin est un snapshot figé produit par le
 * serveur ; l'interface affiche les chaînes déjà formatées (`*Affichee`) et laisse le
 * serveur calculer les écarts entre semestres comme les PDF.
 */

export type StatutBulletin = 'BOUILLON' | 'PRET' | 'PUBLIE' | 'ANNULE';

export interface BulletinResume {
  id: string;
  enrollmentId: string;
  semesterId: string;
  academicYearId: string;
  version: number;
  statut: StatutBulletin;
  estCourant: boolean;
  motifCorrection: string | null;
  remplaceReportCardId: string | null;
  moyenneGenerale: string | null;
  /** Arrondi de l'établissement figé dans le snapshot : c'est la valeur affichée. */
  moyenneGeneraleAffichee?: string | null;
  moyenneGeneraleExacte: string | null;
  moyenneClasse: string | null;
  moyenneClasseAffichee?: string | null;
  effectif: number;
  rang: number | null;
  motifNonClasse: string | null;
  totalPoints: string;
  totalCoeficients: string;
  incomplet: boolean;
  motifs: string[];
  absences?: SnapshotBulletin['absences'] | null;
  mention: string | null;
  decisionConseil: string | null;
  appreciation: string | null;
  genereLe: string | null;
  valideLe: string | null;
  publieLe: string | null;
}

export interface LigneBulletin {
  enrollmentId: string;
  studentId: string;
  matricule: string;
  nom: string;
  prenoms: string;
  classe: string;
  niveau: string | null;
  bulletin: BulletinResume | null;
}

export interface ListeBulletins {
  semestre: { id: string; numero: number; nom: string; academicYearId: string; anneeScolaire: string };
  lignes: LigneBulletin[];
}

export interface VersionBulletin {
  id: string;
  version: number;
  statut: StatutBulletin;
  estCourant: boolean;
  motifCorrection: string | null;
  moyenneGenerale: string | null;
  genereLe: string | null;
  publieLe: string | null;
}

export interface NoteSnapshot {
  assessmentId: string;
  title: string;
  typeName: string;
  category: 'DEVOIR' | 'COMPOSITION' | 'AUTRE';
  statutEvaluation: string;
  outOf: string;
  score: string | null;
  status: 'SAISIE' | 'ABSENT' | 'ANNULEE' | 'NON_SAISIE';
}

export interface GroupeSnapshot {
  category: 'DEVOIR' | 'COMPOSITION' | 'AUTRE';
  poids: string;
  moyenne: string | null;
  moyenneAffichee: string | null;
  notesValides: number;
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
  appreciation: string | null;
}

export interface SnapshotBulletin {
  versionSchema: number;
  genereLe: string;
  dateCalcul: string;
  enTete: {
    nomEtablissement: string;
    ville: string | null;
    intituleDocument: string;
    anneeScolaire: { id: string; nom: string; statut: string };
    semestre: { id: string; numero: number; nom: string };
  };
  eleve: {
    enrollmentId: string;
    classroomId: string;
    matricule: string;
    nom: string;
    prenoms: string;
    classe: string;
    niveau: string | null;
  };
  regles: {
    formuleMatiere: string;
    arrondiDecimales: number;
    baremeParDefaut: string;
    poidsSemestres: { s1: string; s2: string };
  };
  matieres: MatiereSnapshot[];
  synthese: {
    totalPoints: string;
    totalCoeficients: string;
    moyenneGenerale: string | null;
    moyenneGeneraleExacte: string | null;
    moyenneGeneraleAffichee: string | null;
    rang: number | null;
    motifNonClasse: string | null;
    effectif: number;
    moyenneClasse: string | null;
    moyenneClasseAffichee: string | null;
    incomplet: boolean;
  };
  continuite: {
    semestrePrecedent: {
      reportCardId: string | null;
      version: number | null;
      numero: number | null;
      moyenneGenerale: string | null;
      moyenneGeneraleAffichee: string | null;
      rang: number | null;
      statut: StatutBulletin | null;
    } | null;
    changementClasse: boolean;
    classePrecedente: string | null;
  };
  absences?: {
    disponible: boolean;
    absencesJustifiees: number;
    absencesNonJustifiees: number;
    absencesTotal: number;
    retards: number;
    minutesRetard: number;
  };
  motifs: string[];
}

export interface DetailBulletin {
  bulletin: BulletinResume;
  snapshot: SnapshotBulletin;
  historique: VersionBulletin[];
}

export interface ComparaisonSemestre {
  semestreId: string;
  numero: number;
  nom: string;
  reportCardId: string | null;
  version: number | null;
  statut: StatutBulletin | null;
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
  generale: { ecart: string | null; ecartAffiche: string | null; motif: string | null };
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

export interface BilanResume {
  id: string;
  enrollmentId: string;
  academicYearId: string;
  version: number;
  statut: StatutBulletin;
  estCourant: boolean;
  s1ReportCardId: string | null;
  s2ReportCardId: string | null;
  moyenneS1: string | null;
  moyenneS1Affichee?: string | null;
  moyenneS2: string | null;
  moyenneS2Affichee?: string | null;
  moyenneAnnuelle: string | null;
  moyenneAnnuelleAffichee?: string | null;
  moyenneAnnuelleExacte: string | null;
  calculable: boolean;
  partiel: boolean;
  rangAnnuel: number | null;
  effectif: number;
  motifs: string[];
  absences?: SnapshotBulletin['absences'] | null;
  mention: string | null;
  decisionConseil: string | null;
  decisionConseilValideeLe?: string | null;
  appreciation: string | null;
  genereLe: string | null;
  publieLe: string | null;
}

export interface LigneBilan {
  enrollmentId: string;
  studentId: string;
  matricule: string;
  nom: string;
  prenoms: string;
  classe: string;
  niveau: string | null;
  bilan: BilanResume | null;
}

export interface ListeBilans {
  anneeScolaire: { id: string; nom: string; semestres: { id: string; numero: number; nom: string }[] };
  lignes: LigneBilan[];
}

export interface MatiereBilan {
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
}

export interface SnapshotBilanAnnuel {
  versionSchema: number;
  genereLe: string;
  enTete: {
    nomEtablissement: string;
    intituleDocument: string;
    anneeScolaire: { id: string; nom: string; statut: string };
  };
  eleve: {
    enrollmentId: string;
    classroomId: string;
    matricule: string;
    nom: string;
    prenoms: string;
    classe: string;
  };
  semestres: {
    numero: number;
    nom: string;
    reportCardId: string | null;
    version: number | null;
    statut: StatutBulletin | null;
    moyenneGenerale: string | null;
    moyenneGeneraleAffichee: string | null;
    rang: number | null;
    effectif: number | null;
  }[];
  matieres: MatiereBilan[];
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
  absences?: SnapshotBulletin['absences'];
  appreciation: string | null;
  mention: string | null;
  decisionConseil: string | null;
  decisionConseilValideeLe?: string | null;
}

export interface ChampsLibres {
  mention?: string | null;
  appreciation?: string | null;
}

async function demander<T>(url: string, init?: RequestInit): Promise<T> {
  const reponse = await api.fetch(url, init);
  const corps = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    const message =
      (corps as { error?: string }).error ?? `Requête refusée (${reponse.status})`;
    const erreur = new Error(message) as Error & { status?: number };
    erreur.status = reponse.status;
    throw erreur;
  }
  return corps as T;
}

export function chargerBulletins(options: {
  classroomId?: string;
  enrollmentId?: string;
  semesterId: string;
}) {
  const params = new URLSearchParams({ semesterId: options.semesterId });
  if (options.classroomId) params.set('classroomId', options.classroomId);
  if (options.enrollmentId) params.set('enrollmentId', options.enrollmentId);
  return demander<ListeBulletins>(`/api/report-cards?${params.toString()}`);
}

export function chargerBulletin(id: string) {
  return demander<DetailBulletin>(`/api/report-cards/${encodeURIComponent(id)}`);
}

export function genererBulletin(enrollmentId: string, semesterId: string) {
  return demander<{ bulletin: BulletinResume; cree: boolean }>('/api/report-cards/generate', {
    method: 'POST',
    body: JSON.stringify({ enrollmentId, semesterId }),
  });
}

export function genererBulletinsClasse(classroomId: string, semesterId: string) {
  return demander<{
    generes: number;
    maj: number;
    ignores: { enrollmentId: string; motif: string }[];
  }>('/api/report-cards/generate-class', {
    method: 'POST',
    body: JSON.stringify({ classroomId, semesterId }),
  });
}

export function publierBulletins(ids: string[]) {
  return demander<{ publies: number; dejaPublies: number }>('/api/report-cards/publish', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

export function corrigerBulletin(id: string, motif: string) {
  return demander<{ bulletin: BulletinResume }>(
    `/api/report-cards/${encodeURIComponent(id)}/correct`,
    { method: 'POST', body: JSON.stringify({ motif }) }
  );
}

export function modifierChampsLibres(id: string, champs: ChampsLibres) {
  return demander<{ bulletin: BulletinResume }>(`/api/report-cards/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(champs),
  });
}

export function modifierAppreciation(options: {
  enrollmentId: string;
  semesterId: string;
  subjectId: string;
  content: string | null;
}) {
  return demander<{ appreciation: { id: string; content: string } | null }>(
    '/api/school-life/appreciations',
    {
      method: 'PUT',
      body: JSON.stringify({ ...options, content: options.content ?? '' }),
    }
  );
}

export function chargerComparaison(options: { enrollmentId: string; academicYearId: string }) {
  const params = new URLSearchParams(options);
  return demander<ComparaisonSemestres>(`/api/report-cards/comparaison?${params.toString()}`);
}

export function chargerBilansAnnuels(options: { classroomId: string; academicYearId: string }) {
  const params = new URLSearchParams(options);
  return demander<ListeBilans>(`/api/annual-summaries?${params.toString()}`);
}

export function chargerBilanAnnuel(id: string) {
  return demander<{ bilan: BilanResume; snapshot: SnapshotBilanAnnuel }>(
    `/api/annual-summaries/${encodeURIComponent(id)}`
  );
}

export function genererBilanAnnuel(enrollmentId: string, academicYearId: string) {
  return demander<{ bilan: BilanResume; cree: boolean }>('/api/annual-summaries/generate', {
    method: 'POST',
    body: JSON.stringify({ enrollmentId, academicYearId }),
  });
}

export function publierBilansAnnuels(ids: string[]) {
  return demander<{ publies: number; dejaPublies: number }>('/api/annual-summaries/publish', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

/** URL d'impression : un bulletin, un lot sélectionné, ou toute une classe. */
export function urlPdfBulletins(options: {
  ids?: string[];
  classroomId?: string;
  semesterId?: string;
}): string {
  const params = new URLSearchParams();
  if (options.ids?.length) params.set('ids', options.ids.join(','));
  if (options.classroomId) params.set('classroomId', options.classroomId);
  if (options.semesterId) params.set('semesterId', options.semesterId);
  const query = params.toString();
  return `/api/report-cards/pdf${query ? `?${query}` : ''}`;
}

export function urlPdfBilansAnnuels(options: {
  ids?: string[];
  classroomId?: string;
  academicYearId?: string;
}): string {
  const params = new URLSearchParams();
  if (options.ids?.length) params.set('ids', options.ids.join(','));
  if (options.classroomId) params.set('classroomId', options.classroomId);
  if (options.academicYearId) params.set('academicYearId', options.academicYearId);
  const query = params.toString();
  return `/api/annual-summaries/pdf${query ? `?${query}` : ''}`;
}

export interface PdfRecu {
  blob: Blob;
  pages: number;
  nom: string;
}

/**
 * Le PDF est produit par le serveur. On lit uniquement ce qu'il annonce : nombre de
 * pages (en-tête `X-Contenu-Pages`) et nom de fichier (en-tête `Content-Disposition`).
 */
export async function chargerPdf(url: string): Promise<PdfRecu> {
  const reponse = await api.fetch(url);
  if (!reponse.ok) {
    const corps = (await reponse.json().catch(() => ({}))) as { error?: string };
    const message = corps.error ?? `Impression refusée (${reponse.status})`;
    const erreur = new Error(message) as Error & { status?: number };
    erreur.status = reponse.status;
    throw erreur;
  }
  const disposition = reponse.headers.get('Content-Disposition') ?? '';
  const correspondant = /filename="?([^";]+)"?/i.exec(disposition);
  const annonce = reponse.headers.get('X-Contenu-Pages');
  const pages = annonce && /^\d+$/.test(annonce) ? Number(annonce) : 0;
  return {
    blob: await reponse.blob(),
    pages,
    nom: correspondant?.[1] ?? 'document.pdf',
  };
}

/** Téléchargement côté navigateur : aucun traitement du contenu, on enregistre tel quel. */
export async function telechargerPdf(url: string): Promise<PdfRecu> {
  const pdf = await chargerPdf(url);
  if (typeof URL === 'undefined' || typeof document === 'undefined') return pdf;
  const objet = URL.createObjectURL(pdf.blob);
  const lien = document.createElement('a');
  lien.href = objet;
  lien.download = pdf.nom;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  URL.revokeObjectURL(objet);
  return pdf;
}

export const LIBELLES_STATUT_BULLETIN: Record<StatutBulletin, string> = {
  BOUILLON: 'Brouillon',
  PRET: 'Prêt à publier',
  PUBLIE: 'Publié (figé)',
  ANNULE: 'Annulé',
};

/** Rôles autorisés à générer, publier ou corriger (le serveur applique la même règle). */
export const ROLES_EDITION_BULLETIN = ['SCHOOL_ADMIN', 'SURVEILLANT_GENERAL'];

/** Formule de moyenne de matière enregistrée dans le snapshot (mots du moteur de calcul). */
export const LIBELLES_FORMULE_MATIERE: Record<string, string> = {
  POIDS_GROUPES: 'moyenne des groupes de notes pondérés (devoirs et compositions)',
  MOYENNE_TOUTES_NOTES: 'moyenne de toutes les notes confondues',
};
