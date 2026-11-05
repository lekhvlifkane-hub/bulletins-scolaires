/**
 * Moteur de calcul des notes, moyennes, rangs et moyenne annuelle.
 *
 * Règles (cf. docs/DECISIONS.md § Notes / Moyennes / Rangs / Arrondi) :
 * - Décimales partout : `decimal.js`, jamais de `number` flottant pour un calcul de note.
 * - Aucune note manquante ou absente n'est convertie en 0 sans règle explicite.
 * - Une matière sans résultat valide, à coefficient nul/invalide ou non comptabilisée
 *   sort du dénominateur de la moyenne générale.
 * - Précision interne conservée en totalité ; l'arrondi n'intervient qu'à l'affichage.
 * - Aucune valeur fictive : ce qui n'est pas calculable renvoie `null` et un motif.
 *
 * Aucun calcul de ce module n'est répliqué dans le frontend.
 */
import Decimal from 'decimal.js';

export type StatutNote = 'SAISIE' | 'ABSENT' | 'ANNULEE' | 'NON_SAISIE';
export type CategorieEvaluation = 'DEVOIR' | 'COMPOSITION' | 'AUTRE';
export type ModeArrondi = 'half-up' | 'half-even';
export type ModeRang = 'standard' | 'dense';

export interface NoteInput {
  status: StatutNote;
  score?: string | number | null;
  /** Barème de l'évaluation (défaut : barèmeParDefaut, généralement 20). */
  outOf?: string | number | null;
}

export interface EvaluationInput {
  assessmentId: string;
  category: CategorieEvaluation;
  notes: NoteInput[];
}

export interface MatiereInput {
  subjectId: string;
  subjectName?: string;
  coefficient: string | number | null;
  evaluations: EvaluationInput[];
  /** false = matière affichée mais non comptabilisée (réglage établissement). */
  comptabilisee?: boolean;
  /** Version du coefficient : effectiveTo clos = non utilisée pour la date de calcul. */
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
}

export type RegleMatiere = 'POIDS_GROUPES' | 'MOYENNE_TOUTES_NOTES';

export interface ParametresCalcul {
  decimalsAffichage: number;
  arrondi: ModeArrondi;
  normaliserSur20: boolean;
  baremeParDefaut: string | number;
  absencesComptentZero: boolean;
  groupeSansNote: 'exclure' | 'bloquant';
  coefficientInvalide: 'exclure' | 'erreur';
  poidsGroupes: Record<CategorieEvaluation, string | number>;
  /** Formule de la moyenne de matière : groupes pondérés (défaut) ou toutes notes confondues. */
  regleMatiere: RegleMatiere;
  rangMode: ModeRang;
  classerResultatsIncomplets: boolean;
  poidsSemestres: { s1: string | number; s2: string | number };
  annuelSiSemestreManquant: 'null' | 'partiel';
  /** Date de calcul pour retenir la version effective des coefficients. */
  dateCalcul: Date;
}

export const DEFAULT_PARAMETRES: ParametresCalcul = {
  decimalsAffichage: 2,
  arrondi: 'half-up',
  normaliserSur20: true,
  baremeParDefaut: 20,
  absencesComptentZero: false,
  groupeSansNote: 'exclure',
  coefficientInvalide: 'exclure',
  poidsGroupes: { DEVOIR: 1, COMPOSITION: 1, AUTRE: 0 },
  regleMatiere: 'POIDS_GROUPES',
  rangMode: 'standard',
  classerResultatsIncomplets: false,
  poidsSemestres: { s1: 1, s2: 1 },
  annuelSiSemestreManquant: 'null',
  dateCalcul: new Date(),
};

function parametres(partial?: Partial<ParametresCalcul>): ParametresCalcul {
  if (!partial) return DEFAULT_PARAMETRES;
  return {
    ...DEFAULT_PARAMETRES,
    ...partial,
    poidsGroupes: { ...DEFAULT_PARAMETRES.poidsGroupes, ...(partial.poidsGroupes ?? {}) },
    poidsSemestres: { ...DEFAULT_PARAMETRES.poidsSemestres, ...(partial.poidsSemestres ?? {}) },
  };
}

/** Convertit une entrée en Decimal, ou null si elle n'est pas un nombre fini. */
export function versDecimal(valeur: unknown): Decimal | null {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  if (valeur instanceof Decimal) return valeur;
  let d: Decimal;
  try {
    d = new Decimal(String(valeur));
  } catch {
    return null;
  }
  return d.isFinite() ? d : null;
}

const MODES_ARRONDI: Record<ModeArrondi, Decimal.Rounding> = {
  'half-up': Decimal.ROUND_HALF_UP,
  'half-even': Decimal.ROUND_HALF_EVEN,
};

/** Arrondi de présentation uniquement. Renvoie null si rien n'est calculable. */
export function formaterNote(
  valeur: Decimal | null | undefined,
  decimales: number = DEFAULT_PARAMETRES.decimalsAffichage,
  mode: ModeArrondi = DEFAULT_PARAMETRES.arrondi
): string | null {
  if (valeur === null || valeur === undefined) return null;
  return valeur.toDecimalPlaces(decimales, MODES_ARRONDI[mode]).toFixed(decimales);
}

/** Une note comptabilisable : statut SAISIE (ou ABSENT si la règle de l'établissement le dit). */
function valeurExploitable(note: NoteInput, p: ParametresCalcul): Decimal | null {
  if (note.status === 'ANNULEE' || note.status === 'NON_SAISIE') return null;
  if (note.status === 'ABSENT') {
    if (!p.absencesComptentZero) return null;
    return new Decimal(0);
  }
  if (note.status !== 'SAISIE') return null;
  const score = versDecimal(note.score);
  if (score === null) return null;
  const bareme = versDecimal(note.outOf ?? p.baremeParDefaut);
  if (bareme === null || bareme.isZero()) return null;
  if (p.normaliserSur20) {
    if (bareme.isNegative()) return null;
    return score.mul(20).div(bareme);
  }
  return score;
}

export interface GroupeResultat {
  category: CategorieEvaluation;
  moyenne: Decimal | null;
  notesValides: number;
  notesAttendues: number;
  poids: Decimal;
}

export interface ResultatMatiere {
  subjectId: string;
  subjectName?: string;
  coefficient: Decimal | null;
  moyenne: Decimal | null;
  pointsPonderes: Decimal | null;
  comptabilisee: boolean;
  incomplet: boolean;
  motifs: string[];
  groupes: GroupeResultat[];
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
}

function moyenneGroupes(matiere: MatiereInput, p: ParametresCalcul) {
  const parCategorie = new Map<CategorieEvaluation, Decimal[]>();
  const motifs: string[] = [];
  let manquantes = 0;
  let absences = 0;
  let annulees = 0;

  for (const evalua of matiere.evaluations) {
    const categorie = evalua.category;
    for (const note of evalua.notes) {
      const valeur = valeurExploitable(note, p);
      if (valeur !== null) {
        const liste = parCategorie.get(categorie) ?? [];
        liste.push(valeur);
        parCategorie.set(categorie, liste);
      } else if (note.status === 'NON_SAISIE') {
        manquantes += 1;
      } else if (note.status === 'ABSENT') {
        absences += 1;
      } else if (note.status === 'ANNULEE') {
        annulees += 1;
      }
    }
  }

  const groupes: GroupeResultat[] = [];
  const categoriesVues = new Set<CategorieEvaluation>(
    matiere.evaluations.map((e) => e.category)
  );
  for (const categorie of categoriesVues) {
    const poids = versDecimal(p.poidsGroupes[categorie]) ?? new Decimal(0);
    const valeurs = parCategorie.get(categorie) ?? [];
    const moyenne =
      valeurs.length > 0
        ? valeurs.reduce((acc, v) => acc.plus(v), new Decimal(0)).div(valeurs.length)
        : null;
    groupes.push({
      category: categorie,
      moyenne,
      notesValides: valeurs.length,
      notesAttendues: valeurs.length,
      poids,
    });
  }

  if (manquantes > 0) motifs.push(`note manquante : ${manquantes} non saisie(s) exclue(s) du calcul`);
  if (absences > 0) {
    motifs.push(
      p.absencesComptentZero
        ? `${absences} absence(s) comptée(s) comme 0 (règle de l'établissement)`
        : `${absences} absence(s) exclue(s) du calcul`
    );
  }
  if (annulees > 0) motifs.push(`${annulees} note(s) annulée(s) exclue(s) du calcul`);

  return { groupes, motifs, compteurManquantes: manquantes };
}

/**
 * Moyenne d'une matière.
 * Formule par défaut : (moyenne des devoirs + moyenne des compositions) / 2,
 * obtenue par les poids de groupes (DEVOIR 1, COMPOSITION 1).
 */
export function calculerMoyenneMatiere(
  matiere: MatiereInput,
  partial?: Partial<ParametresCalcul>
): {
  moyenne: Decimal | null;
  incomplet: boolean;
  motifs: string[];
  groupes: GroupeResultat[];
} {
  const p = parametres(partial);
  const { groupes, motifs, compteurManquantes } = moyenneGroupes(matiere, p);

  // Règle « toutes notes confondues » : moyenne arithmétique unique sur toutes les
  // notes exploitables de la matière, sans pondération par catégorie. Chaque groupe
  // contribue pour (sa moyenne × son nombre de notes), ce qui redonne exactement la
  // moyenne de l'ensemble des notes.
  if (p.regleMatiere === 'MOYENNE_TOUTES_NOTES') {
    let totalNotes = new Decimal(0);
    let nombreNotes = new Decimal(0);
    for (const g of groupes) {
      if (g.moyenne === null || g.notesValides === 0) continue;
      totalNotes = totalNotes.plus(g.moyenne.times(g.notesValides));
      nombreNotes = nombreNotes.plus(g.notesValides);
    }
    if (nombreNotes.isZero()) {
      return {
        moyenne: null,
        incomplet: true,
        motifs: [...motifs, 'aucune note exploitable : moyenne non calculable'],
        groupes,
      };
    }
    const moyenne = totalNotes.div(nombreNotes);
    return {
      moyenne,
      incomplet: compteurManquantes > 0 || motifs.length > 0,
      motifs: [
        ...motifs,
        `règle établissement « toutes notes confondues » appliquée sur ${nombreNotes.toFixed()} note(s)`,
      ],
      groupes,
    };
  }

  let totalPoids = new Decimal(0);
  let totalPondere = new Decimal(0);
  let groupeBloquant = false;

  for (const g of groupes) {
    if (g.poids.isZero() || g.poids.isNegative()) continue;
    if (g.moyenne === null) {
      if (p.groupeSansNote === 'bloquant') {
        groupeBloquant = true;
        motifs.push(`groupe ${g.category} sans note exploitable : matière bloquée`);
      } else {
        motifs.push(`groupe ${g.category} sans note exploitable : exclu du calcul`);
      }
      continue;
    }
    totalPoids = totalPoids.plus(g.poids);
    totalPondere = totalPondere.plus(g.moyenne.mul(g.poids));
  }

  let moyenne: Decimal | null = null;
  if (groupeBloquant || totalPoids.isZero()) {
    moyenne = null;
    if (groupes.every((g) => g.notesValides === 0)) {
      motifs.push('aucune note exploitable : moyenne non calculable');
    }
  } else {
    moyenne = totalPondere.div(totalPoids);
  }

  return {
    moyenne,
    incomplet: moyenne !== null && (compteurManquantes > 0 || motifs.length > 0),
    motifs,
    groupes,
  };
}

export interface ResultatEleve {
  matieres: ResultatMatiere[];
  totalCoeficients: Decimal;
  totalPoints: Decimal;
  moyenneGenerale: Decimal | null;
  incomplet: boolean;
  motifs: string[];
}

/**
 * Moyenne générale : M = Σ(moyᵢ × coefᵢ) / Σ(coefᵢ),
 * uniquement sur les matières à moyenne valide, coefficient strictement positif
 * et comptabilisées à la date de calcul.
 */
export function calculerResultatsEleve(
  matieres: MatiereInput[],
  partial?: Partial<ParametresCalcul>
): ResultatEleve {
  const p = parametres(partial);
  const motifsGlobaux: string[] = [];
  const resultats: ResultatMatiere[] = [];
  let totalCoeficients = new Decimal(0);
  let totalPoints = new Decimal(0);
  let incomplet = false;

  for (const matiere of matieres) {
    const base = calculerMoyenneMatiere(matiere, p);
    const coefficient = versDecimal(matiere.coefficient);
    const motifs = [...base.motifs];

    let comptabilisee = matiere.comptabilisee !== false;
    if (!comptabilisee) {
      motifs.push("matière non comptabilisée (réglage de l'établissement)");
    }

    if (comptabilisee && coefficient !== null && coefficient.lte(0)) {
      comptabilisee = false;
      motifs.push('coefficient nul ou négatif : matière exclue de la moyenne générale');
      motifsGlobaux.push(`matière ${matiere.subjectId} : coefficient nul ou négatif, exclue du dénominateur`);
    }
    if (comptabilisee && coefficient === null) {
      if (p.coefficientInvalide === 'erreur') {
        motifsGlobaux.push(`coefficient invalide pour la matière ${matiere.subjectId}`);
      }
      comptabilisee = false;
      motifs.push('coefficient invalide : matière exclue de la moyenne générale');
      motifsGlobaux.push(`matière ${matiere.subjectId} : coefficient invalide, exclue du dénominateur`);
    }

    const versionNotStarted =
      matiere.effectiveFrom !== null &&
      matiere.effectiveFrom !== undefined &&
      matiere.effectiveFrom.getTime() > p.dateCalcul.getTime();
    if (comptabilisee && versionNotStarted) {
      comptabilisee = false;
      motifs.push('version du coefficient pas encore effective : non utilisée pour ce calcul');
    }

    const versionClose =
      matiere.effectiveTo !== null &&
      matiere.effectiveTo !== undefined &&
      matiere.effectiveTo.getTime() <= p.dateCalcul.getTime();
    if (comptabilisee && versionClose) {
      comptabilisee = false;
      motifs.push('version du coefficient close : non utilisée pour ce calcul');
    }

    let pointsPonderes: Decimal | null = null;
    if (comptabilisee && base.moyenne !== null && coefficient !== null) {
      pointsPonderes = base.moyenne.mul(coefficient);
      totalCoeficients = totalCoeficients.plus(coefficient);
      totalPoints = totalPoints.plus(pointsPonderes);
    } else if (comptabilisee && base.moyenne === null) {
      incomplet = true;
      motifs.push('matière comptabilisée sans moyenne calculable : hors dénominateur');
    }

    if (base.incomplet) incomplet = true;
    resultats.push({
      subjectId: matiere.subjectId,
      subjectName: matiere.subjectName,
      coefficient,
      moyenne: base.moyenne,
      pointsPonderes,
      comptabilisee,
      incomplet: base.incomplet,
      motifs,
      groupes: base.groupes,
      effectiveFrom: matiere.effectiveFrom ?? null,
      effectiveTo: matiere.effectiveTo ?? null,
    });
  }

  const moyenneGenerale = totalCoeficients.isZero()
    ? null
    : totalPoints.div(totalCoeficients);

  if (moyenneGenerale === null) {
    motifsGlobaux.push('aucune matière comptabilisée avec moyenne : moyenne générale non calculable');
  }
  const matieresIncompletes = resultats.filter((r) => r.comptabilisee && r.incomplet).length;
  if (matieresIncompletes > 0) {
    motifsGlobaux.push(`${matieresIncompletes} matière(s) avec résultats partiels`);
  }

  return {
    matieres: resultats,
    totalCoeficients,
    totalPoints,
    moyenneGenerale,
    incomplet: incomplet || matieresIncompletes > 0,
    motifs: motifsGlobaux,
  };
}

export interface EntreeClassement {
  eleveId: string;
  moyenne: Decimal | null;
  incomplet?: boolean;
}

export interface RangEleve {
  eleveId: string;
  moyenne: Decimal | null;
  rang: number | null;
  motifExclusion: string | null;
}

/**
 * Classement. Ex æquo jugé sur la valeur exacte (avant arrondi d'affichage).
 * - `standard` : 1, 2, 2, 4 (rang suivant sauté)
 * - `dense` : 1, 1, 2 (aucun rang sauté)
 * Les élèves sans moyenne calculable — et, par défaut, ceux dont les résultats
 * sont incomplets — ne sont pas classés.
 */
export function classerEleves(
  eleves: EntreeClassement[],
  partial?: Partial<ParametresCalcul>
): RangEleve[] {
  const p = parametres(partial);
  const classables: EntreeClassement[] = [];
  const nonClassables: RangEleve[] = [];

  for (const e of eleves) {
    if (e.moyenne === null) {
      nonClassables.push({ eleveId: e.eleveId, moyenne: null, rang: null, motifExclusion: 'moyenne non calculable' });
    } else if (e.incomplet && !p.classerResultatsIncomplets) {
      nonClassables.push({ eleveId: e.eleveId, moyenne: e.moyenne, rang: null, motifExclusion: 'résultats incomplets' });
    } else {
      classables.push(e);
    }
  }

  const ordonnes = [...classables].sort((a, b) => b.moyenne!.cmp(a.moyenne!));

  const ranges: RangEleve[] = [];
  let rangCourant = 0;
  let valeurPrecedente: Decimal | null = null;
  const valeursUniques: Decimal[] = [];
  ordonnes.forEach((e, index) => {
    if (valeurPrecedente === null || !e.moyenne!.eq(valeurPrecedente)) {
      rangCourant = index + 1;
      valeurPrecedente = e.moyenne!;
      valeursUniques.push(e.moyenne!);
    }
    const rang = p.rangMode === 'dense' ? valeursUniques.length : rangCourant;
    ranges.push({ eleveId: e.eleveId, moyenne: e.moyenne!, rang, motifExclusion: null });
  });

  return [...ranges, ...nonClassables];
}

export interface ResultatAnnuel {
  moyenne: Decimal | null;
  calculable: boolean;
  partiel: boolean;
  motifs: string[];
}

/**
 * Moyenne annuelle. Par défaut (S1 + S2) / 2, pondération configurable.
 * Un semestre manquant ne devient jamais une note : selon le réglage, le annuel
 * est non calculable ou partiel (et alors clairement signalé).
 */
export function calculerMoyenneAnnuelle(
  s1: Decimal | null | undefined,
  s2: Decimal | null | undefined,
  partial?: Partial<ParametresCalcul>
): ResultatAnnuel {
  const p = parametres(partial);
  const s1v = s1 ?? null;
  const s2v = s2 ?? null;
  const motifs: string[] = [];
  const poidsS1 = versDecimal(p.poidsSemestres.s1) ?? new Decimal(1);
  const poidsS2 = versDecimal(p.poidsSemestres.s2) ?? new Decimal(1);

  if (s1v === null) motifs.push('premier semestre sans moyenne');
  if (s2v === null) motifs.push('second semestre sans moyenne');

  if (s1v === null && s2v === null) {
    return { moyenne: null, calculable: false, partiel: false, motifs };
  }

  if (s1v !== null && s2v !== null) {
    const total = poidsS1.plus(poidsS2);
    if (total.isZero()) {
      return { moyenne: null, calculable: false, partiel: false, motifs: ['poids des semestres nul : réglage invalide'] };
    }
    const moyenne = s1v.mul(poidsS1).plus(s2v.mul(poidsS2)).div(total);
    return { moyenne, calculable: true, partiel: false, motifs: [] };
  }

  if (p.annuelSiSemestreManquant === 'partiel') {
    const unique = (s1v ?? s2v) as Decimal;
    return { moyenne: unique, calculable: false, partiel: true, motifs };
  }

  return { moyenne: null, calculable: false, partiel: false, motifs };
}
