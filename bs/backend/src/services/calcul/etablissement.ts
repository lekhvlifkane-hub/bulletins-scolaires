import type { School } from '@prisma/client';
import type { CategorieEvaluation, ModeArrondi, ModeRang, ParametresCalcul } from './index';

/**
 * Règles de calcul d'une matière :
 * - POIDS_GROUPES (défaut) : Σ(moyenne du groupe × poids) / Σ(poids), poids par catégorie.
 *   Avec DEVOIR 1 et COMPOSITION 1, on obtient (moy. devoirs + moy. compositions) / 2.
 * - MOYENNE_TOUTES_NOTES : toutes les notes valides confondues.
 */
export type RegleCalculMatiere = 'POIDS_GROUPES' | 'MOYENNE_TOUTES_NOTES';

const MODES_ARRONDI: Record<string, ModeArrondi> = {
  HALF_UP: 'half-up',
  HALF_EVEN: 'half-even',
};

const MODES_RANG: Record<string, ModeRang> = {
  STANDARD: 'standard',
  DENSE: 'dense',
};

function chaine(valeur: unknown, defaut: string): string {
  return typeof valeur === 'string' && valeur.length > 0 ? valeur : defaut;
}

function nombre(valeur: unknown, defaut: string): string {
  if (valeur === null || valeur === undefined) return defaut;
  return String(valeur);
}

/**
 * Traduit les paramètres enregistrés de l'établissement en paramètres de calcul.
 * Toute valeur absente ou invalide retombe sur le défaut documenté, jamais sur 0.
 */
export function parametresEtablissement(
  school: Partial<School>,
  overrides: Partial<ParametresCalcul> = {}
): ParametresCalcul {
  const defauts: ParametresCalcul = {
    decimalsAffichage:
      typeof school.arrondiDecimales === 'number' &&
      school.arrondiDecimales >= 0 &&
      school.arrondiDecimales <= 4
        ? school.arrondiDecimales
        : 2,
    arrondi: MODES_ARRONDI[chaine(school.arrondiMode, 'HALF_UP')] ?? 'half-up',
    normaliserSur20: true,
    baremeParDefaut: nombre(school.baremeParDefaut, '20'),
    absencesComptentZero: Boolean(school.absencesComptentZero),
    groupeSansNote: chaine(school.groupeSansNote, 'EXCLURE') === 'BLOQUANT' ? 'bloquant' : 'exclure',
    coefficientInvalide:
      chaine(school.coefficientInvalide, 'EXCLURE') === 'ERREUR' ? 'erreur' : 'exclure',
    poidsGroupes: {
      DEVOIR: nombre(school.poidsDevoirs, '1'),
      COMPOSITION: nombre(school.poidsCompositions, '1'),
      AUTRE: nombre(school.poidsAutres, '0'),
    } as Record<CategorieEvaluation, string>,
    regleMatiere:
      chaine(school.regleCalculMatiere, 'POIDS_GROUPES') === 'MOYENNE_TOUTES_NOTES'
        ? 'MOYENNE_TOUTES_NOTES'
        : 'POIDS_GROUPES',
    rangMode: MODES_RANG[chaine(school.rangMode, 'STANDARD')] ?? 'standard',
    classerResultatsIncomplets: Boolean(school.classerResultatsIncomplets),
    poidsSemestres: {
      s1: nombre(school.poidsSemestre1, '1'),
      s2: nombre(school.poidsSemestre2, '1'),
    },
    annuelSiSemestreManquant:
      chaine(school.annuelSiSemestreManquant, 'NULL') === 'PARTIEL' ? 'partiel' : 'null',
    dateCalcul: new Date(),
  };

  return {
    ...defauts,
    ...overrides,
    poidsGroupes: { ...defauts.poidsGroupes, ...(overrides.poidsGroupes ?? {}) },
    poidsSemestres: { ...defauts.poidsSemestres, ...(overrides.poidsSemestres ?? {}) },
  };
}
