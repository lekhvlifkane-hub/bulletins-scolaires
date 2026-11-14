import { prisma } from '../db/prisma';

export const MATRICULE_PREFIX = 'ELI';

function echapperRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formaterMatricule(prefix: string, numero: number): string {
  return `${prefix}${String(numero).padStart(3, '0')}`;
}

/**
 * Prochain matricule séquentiel de l'établissement (ELI001, ELI002, ...).
 *
 * Le préfixe reste une constante applicative tant qu'aucun champ de
 * configuration n'est ajouté au schéma. La contrainte unique de `Student`
 * protège contre deux créations concurrentes ; l'appelant doit réessayer.
 */
export async function prochainMatricule(
  schoolId: string,
  prefix: string = MATRICULE_PREFIX,
): Promise<string> {
  const students = await prisma.student.findMany({
    where: {
      schoolId,
      matricule: { startsWith: prefix },
    },
    select: { matricule: true },
  });

  const motif = new RegExp(`^${echapperRegex(prefix)}(\\d+)$`, 'i');
  let maximum = 0;
  for (const student of students) {
    const correspondance = motif.exec(student.matricule);
    if (!correspondance) continue;
    const numero = Number.parseInt(correspondance[1]!, 10);
    if (Number.isFinite(numero) && numero > maximum) maximum = numero;
  }

  return formaterMatricule(prefix, maximum + 1);
}
