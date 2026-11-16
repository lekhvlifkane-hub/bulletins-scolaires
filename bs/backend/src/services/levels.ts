import { prisma } from '../db/prisma';

/**
 * Niveaux et séries par défaut du système éducatif sénégalais.
 *
 * Le collège fournit les quatre niveaux du brevet (6e → 3e), le lycée les
 * trois niveaux du baccalauréat (2nde → Terminale). Les séries du lycée
 * (L1, L2, S1, S2, S3) sont indicatives et restent librement modifiables par
 * l'établissement depuis l'écran « Niveaux et séries » : aucune donnée
 * existante n'est jamais écrasée.
 */

export const DEFAULT_SERIES = ['L1', 'L2', 'S1', 'S2', 'S3'];

export interface DefaultLevel {
  name: string;
  sortOrder: number;
  series: string[];
}

const SERIES_LYCEE = DEFAULT_SERIES;

export const DEFAULT_LEVELS: DefaultLevel[] = [
  { name: '6e', sortOrder: 1, series: [] },
  { name: '5e', sortOrder: 2, series: [] },
  { name: '4e', sortOrder: 3, series: [] },
  { name: '3e', sortOrder: 4, series: [] },
  { name: '2nde', sortOrder: 5, series: SERIES_LYCEE },
  { name: '1ère', sortOrder: 6, series: SERIES_LYCEE },
  { name: 'Terminale', sortOrder: 7, series: SERIES_LYCEE },
];

const ALIAS_NIVEAU: Record<string, string> = {
  sixieme: '6e',
  cinquieme: '5e',
  quatrieme: '4e',
  troisieme: '3e',
  seconde: '2nde',
  premiere: '1ere',
  terminale: 'terminale',
};

/** Normalise un nom de niveau ou de classe (accents, casse, espaces). */
export function normaliserTexteValeur(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('fr-FR');
}

/**
 * Clé de comparaison d'un niveau : « Sixième », « 6e » et « 6 E » désignent le
 * même niveau. Sert à ne pas créer de doublon dans un établissement existant.
 */
export function cleNiveau(value: string): string {
  const normalise = normaliserTexteValeur(value);
  return ALIAS_NIVEAU[normalise] ?? normalise;
}

export interface EnsureLevelsResult {
  createdLevels: number;
  createdSeries: number;
}

/**
 * Ajoute les niveaux et séries manquants pour un établissement.
 *
 * Idempotent et non destructif : un niveau déjà présent (même sous un autre
 * libellé, par exemple « Sixième ») est conservé tel quel, et les séries déjà
 * créées ne sont jamais remplacées. Les créations concurrentes sont absorbées
 * par `skipDuplicates` (contraintes d'unicité PostgreSQL).
 */
export async function ensureDefaultLevels(schoolId: string): Promise<EnsureLevelsResult> {
  const niveauxAvant = await prisma.level.count({ where: { schoolId, deletedAt: null } });
  const seriesAvant = await prisma.series.count({ where: { schoolId, deletedAt: null } });

  await prisma.level.createMany({
    data: DEFAULT_LEVELS.map((niveau) => ({
      schoolId,
      name: niveau.name,
      sortOrder: niveau.sortOrder,
    })),
    skipDuplicates: true,
  });

  const niveaux = await prisma.level.findMany({
    where: { schoolId, deletedAt: null },
    select: { id: true, name: true },
  });
  const parCle = new Map(niveaux.map((niveau) => [cleNiveau(niveau.name), niveau]));

  const series: { schoolId: string; levelId: string; name: string }[] = [];
  for (const defaut of DEFAULT_LEVELS) {
    const niveau = parCle.get(cleNiveau(defaut.name));
    if (!niveau) continue;
    for (const nom of defaut.series) {
      series.push({ schoolId, levelId: niveau.id, name: nom });
    }
  }
  if (series.length > 0) {
    await prisma.series.createMany({ data: series, skipDuplicates: true });
  }

  const niveauxApres = await prisma.level.count({ where: { schoolId, deletedAt: null } });
  const seriesApres = await prisma.series.count({ where: { schoolId, deletedAt: null } });

  return {
    createdLevels: Math.max(0, niveauxApres - niveauxAvant),
    createdSeries: Math.max(0, seriesApres - seriesAvant),
  };
}

/**
 * Retrouve le niveau correspondant à une classe à partir de son nom
 * (« 6e 1 » → 6e, « Terminale S2 » → Terminale). Retourne `null` si aucun
 * niveau de l'établissement ne correspond au début du nom de la classe.
 */
export function infererNiveau(
  nomClasse: string,
  niveaux: { id: string; name: string }[],
): { id: string; name: string } | null {
  const cible = normaliserTexteValeur(nomClasse);
  const candidats = niveaux
    .map((niveau) => ({ niveau, cle: cleNiveau(niveau.name) }))
    .filter(({ cle }) => cible === cle || cible.startsWith(`${cle} `) || cible.startsWith(`${cle}-`) || cible.startsWith(cle))
    .sort((a, b) => b.cle.length - a.cle.length);
  return candidats[0]?.niveau ?? null;
}