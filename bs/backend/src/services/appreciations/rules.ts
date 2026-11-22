import { Prisma, type AppreciationRule } from '@prisma/client';
import Decimal from 'decimal.js';
import { prisma } from '../../db/prisma';

/**
 * Règles d'appréciation automatique d'un établissement.
 *
 * Les seuils sont stockés en base pour rester modifiables depuis les paramètres.
 * La sélection utilise le seuil bas le plus élevé atteint : une note de 16,00
 * tombe donc dans « Bien » (14–16) ou « Très bien » (16–18) selon la borne
 * configurée, sans trou ni chevauchement silencieux.
 */

export type AppreciationScope = 'MATIERE' | 'MENTION' | 'DECISION' | 'GENERALE';

export interface DefaultRule {
  scope: AppreciationScope;
  code: string;
  label: string;
  minScore: string;
  maxScore: string;
  content: string;
  sortOrder: number;
}

const SUBJECT_LABELS: { code: string; label: string; min: string; max: string; order: number }[] = [
  { code: '0_5', label: 'Très médiocre', min: '0', max: '5', order: 1 },
  { code: '5_6_5', label: 'Médiocre', min: '5', max: '6.5', order: 2 },
  { code: '6_5_8', label: 'Très insuffisant', min: '6.5', max: '8', order: 3 },
  { code: '8_10', label: 'Insuffisant', min: '8', max: '10', order: 4 },
  { code: '10_12', label: 'Passable', min: '10', max: '12', order: 5 },
  { code: '12_14', label: 'Assez bien', min: '12', max: '14', order: 6 },
  { code: '14_16', label: 'Bien', min: '14', max: '16', order: 7 },
  { code: '16_18', label: 'Très bien', min: '16', max: '18', order: 8 },
  { code: '18_20', label: 'Excellent', min: '18', max: '20', order: 9 },
];

const DECISIONS: { code: string; label: string; min: string; max: string; order: number }[] = [
  { code: '0_8', label: 'Avertissement travail', min: '0', max: '8', order: 1 },
  { code: '8_10', label: 'Avertissement travail', min: '8', max: '10', order: 2 },
  { code: '10_12', label: 'Passable', min: '10', max: '12', order: 3 },
  { code: '12_14', label: 'Encouragements', min: '12', max: '14', order: 4 },
  { code: '14_16', label: "Tableau d'honneur", min: '14', max: '16', order: 5 },
  { code: '16_20', label: 'Félicitations', min: '16', max: '20', order: 6 },
];

const GENERAL_TEMPLATES: Record<string, string> = {
  '0_5': "Le travail de {prenom} reste très médiocre ce semestre (moyenne {moyenne}/20).",
  '5_6_5': "Les résultats de {prenom} sont médiocres (moyenne {moyenne}/20).",
  '6_5_8': "Les résultats de {prenom} sont très insuffisants (moyenne {moyenne}/20).",
  '8_10': "Les résultats de {prenom} sont insuffisants (moyenne {moyenne}/20).",
  '10_12': "Les résultats de {prenom} sont passables (moyenne {moyenne}/20).",
  '12_14': "Les résultats de {prenom} sont assez satisfaisants (moyenne {moyenne}/20).",
  '14_16': "Les résultats de {prenom} sont bons (moyenne {moyenne}/20).",
  '16_18': "Les résultats de {prenom} sont très bons (moyenne {moyenne}/20).",
  '18_20': "Les résultats de {prenom} sont excellents (moyenne {moyenne}/20).",
};

/** Règles par défaut créées pour chaque établissement, sans écraser une personnalisation. */
export const DEFAULT_APPRECIATION_RULES: DefaultRule[] = [
  ...SUBJECT_LABELS.map((rule) => ({
    scope: 'MATIERE' as const,
    code: `MATIERE_${rule.code}`,
    label: rule.label,
    minScore: rule.min,
    maxScore: rule.max,
    content: rule.label,
    sortOrder: rule.order,
  })),
  ...SUBJECT_LABELS.map((rule) => ({
    scope: 'MENTION' as const,
    code: `MENTION_${rule.code}`,
    label: rule.label,
    minScore: rule.min,
    maxScore: rule.max,
    content: rule.label,
    sortOrder: rule.order,
  })),
  ...DECISIONS.map((rule) => ({
    scope: 'DECISION' as const,
    code: `DECISION_${rule.code}`,
    label: rule.label,
    minScore: rule.min,
    maxScore: rule.max,
    content: rule.label,
    sortOrder: rule.order,
  })),
  ...SUBJECT_LABELS.map((rule) => ({
    scope: 'GENERALE' as const,
    code: `GENERALE_${rule.code}`,
    label: rule.label,
    minScore: rule.min,
    maxScore: rule.max,
    content: GENERAL_TEMPLATES[rule.code] ?? rule.label,
    sortOrder: rule.order,
  })),
];

function decimalOuNull(valeur: string | number | null | undefined): Prisma.Decimal | null {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  return new Prisma.Decimal(String(valeur));
}

/**
 * Ajoute les règles manquantes pour un établissement. Idempotent : une règle déjà
 * présente (même personnalisée) n'est jamais remplacée.
 */
export async function ensureDefaultAppreciationRules(schoolId: string): Promise<void> {
  await prisma.appreciationRule.createMany({
    data: DEFAULT_APPRECIATION_RULES.map((rule) => ({
      schoolId,
      scope: rule.scope,
      code: rule.code,
      label: rule.label,
      minScore: decimalOuNull(rule.minScore),
      maxScore: decimalOuNull(rule.maxScore),
      content: rule.content,
      sortOrder: rule.sortOrder,
    })),
    skipDuplicates: true,
  });
}

export interface AppreciationRules {
  matiere: AppreciationRule[];
  mention: AppreciationRule[];
  decision: AppreciationRule[];
  generale: AppreciationRule[];
}

export async function chargerReglesAppreciation(schoolId: string): Promise<AppreciationRules> {
  await ensureDefaultAppreciationRules(schoolId);
  const rows = await prisma.appreciationRule.findMany({
    where: { schoolId, deletedAt: null, isActive: true },
    orderBy: [{ scope: 'asc' }, { sortOrder: 'asc' }, { minScore: 'asc' }],
  });
  return {
    matiere: rows.filter((rule) => rule.scope === 'MATIERE'),
    mention: rows.filter((rule) => rule.scope === 'MENTION'),
    decision: rows.filter((rule) => rule.scope === 'DECISION'),
    generale: rows.filter((rule) => rule.scope === 'GENERALE'),
  };
}

function valeur(valeur: Decimal | string | number | null | undefined): Decimal | null {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  try {
    const decimal = new Decimal(String(valeur));
    return decimal.isFinite() ? decimal : null;
  } catch {
    return null;
  }
}

/** Règle dont le seuil bas est le plus élevé tout en restant atteint. */
export function choisirRegle(
  rules: AppreciationRule[],
  score: Decimal | string | number | null | undefined,
): AppreciationRule | null {
  const note = valeur(score);
  if (note === null) return null;
  const candidates = rules
    .filter((rule) => {
      if (rule.minScore === null || rule.maxScore === null) return false;
      return note.gte(rule.minScore) && note.lte(rule.maxScore);
    })
    .sort((a, b) => {
      const seuil = b.minScore!.cmp(a.minScore!);
      return seuil !== 0 ? seuil : b.sortOrder - a.sortOrder;
    });
  return candidates[0] ?? null;
}

export function appreciationMatiere(
  rules: AppreciationRule[],
  moyenne: Decimal | string | number | null | undefined,
): string | null {
  const rule = choisirRegle(rules, moyenne);
  if (!rule) return null;
  return rule.content.trim() || rule.label;
}

export function mentionPour(
  rules: AppreciationRule[],
  moyenne: Decimal | string | number | null | undefined,
): string | null {
  return choisirRegle(rules, moyenne)?.label ?? null;
}

export function decisionPour(
  rules: AppreciationRule[],
  moyenne: Decimal | string | number | null | undefined,
): string | null {
  return choisirRegle(rules, moyenne)?.label ?? null;
}
