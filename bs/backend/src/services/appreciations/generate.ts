import Decimal from 'decimal.js';
import {
  choisirRegle,
  decisionPour,
  mentionPour,
  type AppreciationRules,
} from './rules';

export interface MatiereResultat {
  subjectName: string;
  moyenne: Decimal | string | number | null;
}

export interface AbsencesResultat {
  total?: number | null;
  nonJustifiees?: number | null;
}

export interface AppreciationGeneraleInput {
  studentId: string;
  prenom: string;
  moyenne: Decimal | string | number | null;
  rang?: number | null;
  effectif?: number | null;
  matieres: MatiereResultat[];
  absences?: AbsencesResultat | null;
  moyennePrecedente?: Decimal | string | number | null;
  rules: AppreciationRules;
  seed?: string;
}

export interface AppreciationGeneraleOutput {
  appreciation: string | null;
  mention: string | null;
  decision: string | null;
}

function versDecimal(value: Decimal | string | number | null | undefined): Decimal | null {
  if (value === null || value === undefined || value === '') return null;
  try {
    const decimal = new Decimal(String(value));
    return decimal.isFinite() ? decimal : null;
  } catch {
    return null;
  }
}

function formaterNote(value: Decimal): string {
  return value.toDecimalPlaces(2).toFixed(2).replace('.', ',');
}

function hashStable(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function choisirVarianteStable(content: string, seed: string): string {
  const variantes = content
    .split('||')
    .map((variante) => variante.trim())
    .filter(Boolean);
  if (variantes.length === 0) return '';
  if (variantes.length === 1) return variantes[0]!;
  return variantes[hashStable(seed) % variantes.length]!;
}

function joindreMatieres(matieres: string[]): string {
  if (matieres.length === 0) return '';
  if (matieres.length === 1) return matieres[0]!;
  return `${matieres.slice(0, -1).join(', ')} et ${matieres[matieres.length - 1]}`;
}

function phraseResultats(
  matieres: MatiereResultat[],
  moyenne: Decimal,
): string {
  const valeurs = matieres
    .map((matiere) => ({ nom: matiere.subjectName, moyenne: versDecimal(matiere.moyenne) }))
    .filter((matiere): matiere is { nom: string; moyenne: Decimal } => matiere.moyenne !== null);

  const forts = valeurs
    .filter((matiere) => matiere.moyenne.gte(12))
    .sort((a, b) => b.moyenne.cmp(a.moyenne))
    .slice(0, 2)
    .map((matiere) => matiere.nom);

  const faibles = valeurs
    .filter((matiere) => matiere.moyenne.lt(10))
    .sort((a, b) => a.moyenne.cmp(b.moyenne))
    .slice(0, 2)
    .map((matiere) => matiere.nom);

  if (forts.length > 0 && faibles.length > 0) {
    return `Les acquis sont solides en ${joindreMatieres(forts)} ; des efforts restent à fournir en ${joindreMatieres(faibles)}.`;
  }
  if (forts.length > 0) {
    return `Les acquis sont solides en ${joindreMatieres(forts)}.`;
  }
  if (faibles.length > 0) {
    return moyenne.lt(8)
      ? `Les bases doivent être reprises en ${joindreMatieres(faibles)}.`
      : `Des efforts restent à fournir en ${joindreMatieres(faibles)}.`;
  }
  return 'Les résultats sont homogènes et doivent être complétés par les notes du semestre.';
}

function phraseEvolution(
  moyenne: Decimal,
  moyennePrecedente: Decimal | null,
): string | null {
  if (moyennePrecedente === null) return null;
  const ecart = moyenne.minus(moyennePrecedente);
  if (ecart.gte(0.5)) return 'Les résultats sont en progression par rapport au semestre précédent.';
  if (ecart.lte(-0.5)) return 'Les résultats sont en baisse par rapport au semestre précédent.';
  return 'Les résultats sont stables par rapport au semestre précédent.';
}

function phraseAbsences(absences: AbsencesResultat | null | undefined): string | null {
  if (absences?.total === null || absences?.total === undefined) return null;
  if (absences.total <= 0) return "L'assiduité est satisfaisante.";
  const nonJustifiees = absences.nonJustifiees ?? 0;
  if (nonJustifiees > 0) {
    return `${absences.total} absence(s) sont à signaler, dont ${nonJustifiees} non justifiée(s).`;
  }
  return `${absences.total} absence(s) sont à signaler.`;
}

function phraseConseil(moyenne: Decimal): string {
  if (moyenne.gte(16)) return 'Continue sur cette voie.';
  if (moyenne.gte(14)) return 'Poursuis tes efforts avec la même régularité.';
  if (moyenne.gte(12)) return 'Consolide ces acquis par un travail régulier.';
  if (moyenne.gte(10)) return "Redouble d'efforts pour progresser.";
  return 'Un travail plus régulier et une remise à niveau sont indispensables.';
}

function modeleParDefaut(moyenne: Decimal): string {
  if (moyenne.gte(16)) return 'Les résultats sont très bons';
  if (moyenne.gte(14)) return 'Les résultats sont bons';
  if (moyenne.gte(12)) return 'Les résultats sont assez satisfaisants';
  if (moyenne.gte(10)) return 'Les résultats sont passables';
  if (moyenne.gte(8)) return 'Les résultats sont insuffisants';
  return 'Les résultats sont très fragiles';
}

function rendreModele(
  modele: string,
  input: AppreciationGeneraleInput,
  moyenne: Decimal,
  forts: string[],
  faibles: string[],
): string {
  const valeurs: Record<string, string> = {
    prenom: input.prenom,
    moyenne: formaterNote(moyenne),
    rang: input.rang != null ? String(input.rang) : '—',
    effectif: input.effectif != null ? String(input.effectif) : '—',
    points_forts: forts.length > 0 ? joindreMatieres(forts) : 'les matières principales',
    points_faibles: faibles.length > 0 ? joindreMatieres(faibles) : 'certaines matières',
    absences: input.absences?.total != null ? String(input.absences.total) : '—',
  };
  return modele.replace(/\{(\w+)\}/g, (_match, cle: string) => valeurs[cle] ?? '');
}

/**
 * Produit l'appréciation générale, la mention et la décision proposée.
 *
 * Le texte est stable pour un même élève et un même semestre : les variantes
 * sont choisies par un hash du seed, jamais par Math.random().
 */
export function genererAppreciationGenerale(
  input: AppreciationGeneraleInput,
): AppreciationGeneraleOutput {
  const moyenne = versDecimal(input.moyenne);
  if (moyenne === null) {
    return { appreciation: null, mention: null, decision: null };
  }

  const valeurs = input.matieres
    .map((matiere) => ({ nom: matiere.subjectName, moyenne: versDecimal(matiere.moyenne) }))
    .filter((matiere): matiere is { nom: string; moyenne: Decimal } => matiere.moyenne !== null);
  const forts = valeurs
    .filter((matiere) => matiere.moyenne.gte(12))
    .sort((a, b) => b.moyenne.cmp(a.moyenne))
    .slice(0, 2)
    .map((matiere) => matiere.nom);
  const faibles = valeurs
    .filter((matiere) => matiere.moyenne.lt(10))
    .sort((a, b) => a.moyenne.cmp(b.moyenne))
    .slice(0, 2)
    .map((matiere) => matiere.nom);

  const regle = choisirRegle(input.rules.generale, moyenne);
  const modele = regle
    ? choisirVarianteStable(regle.content, input.seed ?? `${input.studentId}:${moyenne.toFixed(2)}`)
    : `${modeleParDefaut(moyenne)} (moyenne ${formaterNote(moyenne)}/20).`;
  const phraseModele = rendreModele(modele, input, moyenne, forts, faibles);
  const resultats = phraseResultats(input.matieres, moyenne);
  const evolution = phraseEvolution(moyenne, versDecimal(input.moyennePrecedente));
  const absences = phraseAbsences(input.absences);

  const suivi = [evolution, absences].filter(Boolean).join(' ');
  const conclusion = suivi || phraseConseil(moyenne);

  return {
    appreciation: [phraseModele, resultats, conclusion].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
    mention: mentionPour(input.rules.mention, moyenne),
    decision: decisionPour(input.rules.decision, moyenne),
  };
}
